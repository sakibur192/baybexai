/*
 * BaybexAI — SEO-friendly showcase website + Admin panel (Bangla + English)
 * Single-file Node.js (Express) server. No .env, no .yml — all config is below.
 * All data (content, blog, leads, analytics, admins, uploaded images) lives in PostgreSQL.
 * Tables are created automatically on first run.
 */
const express = require('express');
const compression = require('compression');
const multer = require('multer');
const { Pool } = require('pg');
const sizeOf = require('image-size');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/* ============================== CONFIG ============================== */
const CONFIG = {
  PORT: 3000,
  HOST: '0.0.0.0',
  SITE_URL: 'https://baybexai.com', // canonical domain (no trailing slash)
  FORCE_CANONICAL_HOST: true,       // 301 www.baybexai.com → baybexai.com
  FORCE_HTTPS: true,                // 301 http → https (when behind a proxy that sets x-forwarded-proto)
  // PostgreSQL connection
  DATABASE_URL: 'postgres://postgres:sakibbaybexai@201.18.212.48:5447/postgres',
  DB_SSL: false, // set true if your Postgres requires SSL
  // First-run admin login. You will be asked to change the password after first login.
  DEFAULT_ADMIN_USER: 'admin',
  DEFAULT_ADMIN_PASS: 'Baybex@2026',
  SESSION_HOURS: 12,
  MAX_UPLOAD_MB: 5,
  ANALYTICS_KEEP_DAYS: 400,
  TIMEZONE: 'Asia/Dhaka',
  PUBLIC_DIR: path.join(__dirname, 'public'),
  ASSET_VERSION: Date.now().toString(36), // cache-busting for /assets/site.js
};

/* ============================== HELPERS ============================== */
const uid = () => crypto.randomBytes(8).toString('hex');
const bi = (en, bn) => ({ en, bn });
const now = () => new Date().toISOString();
const slugify = (s) =>
  String(s || '').toLowerCase().trim().replace(/[^a-z0-9ঀ-৿]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90) || uid();
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const safeUrl = (u) => (typeof u === 'string' && /^(https?:\/\/|\/(?!\/)|#|mailto:|tel:)/i.test(u.trim()) ? u.trim() : '');
const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

function hashPassword(pass, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(String(pass), salt, 64).toString('hex') };
}
function checkPassword(pass, salt, hash) {
  const h = crypto.scryptSync(String(pass), salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}

const MIME_BY_EXT = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif' };

/* ============================== SEED DATA ============================== */
function seed() {
  const cats = [
    { id: 'erp', name: bi('ERP Software', 'ইআরপি সফটওয়্যার'), icon: '🏢', order: 1,
      description: bi('Ready-made ERP and business management software for Bangladeshi shops, showrooms, pharmacies, restaurants and factories — customised to how you work.', 'বাংলাদেশের দোকান, শোরুম, ফার্মেসি, রেস্টুরেন্ট ও কারখানার জন্য রেডিমেড ইআরপি ও বিজনেস ম্যানেজমেন্ট সফটওয়্যার — আপনার কাজের ধরন অনুযায়ী কাস্টমাইজড।'),
      seoTitle: bi('ERP Software in Bangladesh — Pharmacy, Restaurant, Showroom & Shop ERP', 'বাংলাদেশে ইআরপি সফটওয়্যার — ফার্মেসি, রেস্টুরেন্ট, শোরুম ও দোকানের ইআরপি'),
      seoDescription: bi('Baybex ERP software for pharmacies, restaurants, tile & sanitary shops, gadget shops, motorcycle showrooms and small businesses in Bangladesh. Bangla & English.', 'ফার্মেসি, রেস্টুরেন্ট, টাইলস-স্যানিটারি, গ্যাজেট শপ, মোটরসাইকেল শোরুম ও ছোট ব্যবসার জন্য বেবেক্স ইআরপি সফটওয়্যার। বাংলা ও ইংরেজিতে।') },
    { id: 'ecommerce', name: bi('E-commerce', 'ই-কমার্স'), icon: '🛒', order: 2,
      description: bi('Custom e-commerce websites and landing stores with bKash/Nagad, cash on delivery, courier integration and Meta Pixel — built for your business, not from a template.', 'বিকাশ/নগদ, ক্যাশ অন ডেলিভারি, কুরিয়ার ইন্টিগ্রেশন ও মেটা পিক্সেলসহ কাস্টম ই-কমার্স ওয়েবসাইট ও ল্যান্ডিং স্টোর — টেমপ্লেট নয়, আপনার ব্যবসার জন্য তৈরি।'),
      seoTitle: bi('E-commerce Website Development in Bangladesh', 'বাংলাদেশে ই-কমার্স ওয়েবসাইট ডেভেলপমেন্ট'),
      seoDescription: bi('Get a custom e-commerce website in Bangladesh with admin panel, bKash/Nagad, COD, courier booking, coupons and Meta Pixel. By Baybex.', 'অ্যাডমিন প্যানেল, বিকাশ/নগদ, ক্যাশ অন ডেলিভারি, কুরিয়ার বুকিং, কুপন ও মেটা পিক্সেলসহ কাস্টম ই-কমার্স ওয়েবসাইট — বেবেক্স।') },
    { id: 'ai', name: bi('AI Automation', 'এআই অটোমেশন'), icon: '🤖', order: 3,
      description: bi('AI tools that answer customers and automate routine work for your business, in Bangla and English.', 'বাংলা ও ইংরেজিতে কাস্টমারের উত্তর দেওয়া ও নিয়মিত কাজ স্বয়ংক্রিয় করার এআই টুল।'),
      seoTitle: bi('AI Automation for Business in Bangladesh — Facebook & WhatsApp Auto-reply', 'বাংলাদেশে ব্যবসার জন্য এআই অটোমেশন — ফেসবুক ও হোয়াটসঅ্যাপ অটো-রিপ্লাই'),
      seoDescription: bi('AI auto-reply for Facebook Page, Instagram and WhatsApp in Bangla and English, plus AI automation tools from Baybex.', 'ফেসবুক পেজ, ইনস্টাগ্রাম ও হোয়াটসঅ্যাপে বাংলা ও ইংরেজিতে এআই অটো-রিপ্লাই এবং বেবেক্সের এআই অটোমেশন টুল।') },
    { id: 'custom', name: bi('Custom Development', 'কাস্টম ডেভেলপমেন্ট'), icon: '🛠️', order: 4,
      description: bi('Custom websites, Android apps and personal branding sites built from scratch for your needs.', 'আপনার প্রয়োজন অনুযায়ী শুরু থেকে তৈরি কাস্টম ওয়েবসাইট, অ্যান্ড্রয়েড অ্যাপ ও পার্সোনাল ব্র্যান্ডিং সাইট।'),
      seoTitle: bi('Custom Website & Android App Development in Bangladesh', 'বাংলাদেশে কাস্টম ওয়েবসাইট ও অ্যান্ড্রয়েড অ্যাপ ডেভেলপমেন্ট'),
      seoDescription: bi('Business websites, Android apps (Kotlin) and personal branding websites developed by Baybex in Bangladesh.', 'বেবেক্সের তৈরি বিজনেস ওয়েবসাইট, অ্যান্ড্রয়েড অ্যাপ (Kotlin) ও পার্সোনাল ব্র্যান্ডিং ওয়েবসাইট।') },
  ];
  const contactPrice = bi('Contact for pricing', 'মূল্য জানতে যোগাযোগ করুন');
  const S = (category, icon, name, short, description, features, extra = {}) => ({
    id: uid(), slug: slugify(name.en), category, icon, name, short, description,
    features, price: contactPrice, priceValue: 0, image: '', gallery: [], demoUrl: '', badge: bi('', ''),
    seoTitle: bi('', ''), seoDescription: bi('', ''),
    featured: false, visible: true, ...extra,
  });
  let order = 0;
  const solutions = [
    S('erp', '💊', bi('Pharmacy ERP', 'ফার্মেসি ইআরপি'),
      bi('Stock, racks, sales, dues and suppliers for pharmacies.', 'ফার্মেসির স্টক, র‍্যাক, বিক্রি, বাকি ও সাপ্লায়ার — এক জায়গায়।'),
      bi('A complete pharmacy management system: know exactly which medicine is on which rack, track expiry, sell fast, manage customer dues, suppliers, purchases and expenses, and see clear daily reports.',
         'সম্পূর্ণ ফার্মেসি ম্যানেজমেন্ট সিস্টেম: কোন ওষুধ কোন র‍্যাকে আছে, মেয়াদ কবে শেষ — সব জানুন। দ্রুত বিক্রি, কাস্টমারের বাকি, সাপ্লায়ার, ক্রয় ও খরচের হিসাব এবং পরিষ্কার দৈনিক রিপোর্ট।'),
      [bi('Rack-wise medicine stock', 'র‍্যাক অনুযায়ী ওষুধের স্টক'), bi('Expiry alerts', 'মেয়াদোত্তীর্ণের সতর্কতা'), bi('Fast sales & invoices', 'দ্রুত বিক্রি ও ইনভয়েস'), bi('Customer due tracking', 'কাস্টমারের বাকির হিসাব'), bi('Suppliers & purchases', 'সাপ্লায়ার ও ক্রয়'), bi('Expense & profit reports', 'খরচ ও লাভের রিপোর্ট')],
      { featured: true }),
    S('erp', '🏍️', bi('Motorcycle Showroom ERP', 'মোটরসাইকেল শোরুম ইআরপি'),
      bi('Built for new & second-hand motorcycle showrooms.', 'নতুন ও সেকেন্ড-হ্যান্ড মোটরসাইকেল শোরুমের জন্য।'),
      bi('Manage bike inventory by chassis and engine number, purchases from sellers, sales, installments, papers and documents, and role-based access for owner, manager, sales and accounts.',
         'চেসিস ও ইঞ্জিন নম্বর ধরে বাইকের ইনভেন্টরি, বিক্রেতার কাছ থেকে ক্রয়, বিক্রি, কিস্তি, কাগজপত্র এবং মালিক, ম্যানেজার, সেলস ও অ্যাকাউন্টসের জন্য আলাদা অ্যাক্সেস।'),
      [bi('Chassis / engine number tracking', 'চেসিস / ইঞ্জিন নম্বর ট্র্যাকিং'), bi('Buy & sell second-hand bikes', 'সেকেন্ড-হ্যান্ড বাইক ক্রয়-বিক্রয়'), bi('Installment management', 'কিস্তি ব্যবস্থাপনা'), bi('Document & paper status', 'কাগজপত্রের অবস্থা'), bi('Role-based staff access', 'রোল অনুযায়ী স্টাফ অ্যাক্সেস'), bi('Profit per bike report', 'প্রতি বাইকের লাভের রিপোর্ট')]),
    S('erp', '🏪', bi('Small Business ERP', 'স্মল বিজনেস ইআরপি'),
      bi('POS, inventory and accounts for any small shop.', 'যেকোনো ছোট দোকানের জন্য POS, ইনভেন্টরি ও হিসাব।'),
      bi('An easy all-in-one system for retail shops and small businesses: point of sale, stock, purchases, customer & supplier ledgers, expenses and reports — usable from mobile or computer.',
         'খুচরা দোকান ও ছোট ব্যবসার জন্য সহজ অল-ইন-ওয়ান সিস্টেম: POS, স্টক, ক্রয়, কাস্টমার ও সাপ্লায়ার লেজার, খরচ ও রিপোর্ট — মোবাইল বা কম্পিউটার থেকে চালানো যায়।'),
      [bi('Point of sale (POS)', 'পয়েন্ট অব সেল (POS)'), bi('Stock & low-stock alerts', 'স্টক ও কম স্টকের সতর্কতা'), bi('Customer & supplier ledger', 'কাস্টমার ও সাপ্লায়ার লেজার'), bi('Expense tracking', 'খরচের হিসাব'), bi('Daily / monthly reports', 'দৈনিক / মাসিক রিপোর্ট')]),
    S('erp', '🧱', bi('Tile, Sanitary & Hardware ERP', 'টাইলস, স্যানিটারি ও হার্ডওয়্যার ইআরপি'),
      bi('For tile, sanitary & hardware shops and wholesalers.', 'টাইলস, স্যানিটারি ও হার্ডওয়্যার দোকান ও পাইকারদের জন্য।'),
      bi('Handles box/piece and square-feet calculations, brand & size-wise stock, wholesale and retail pricing, dealer dues, deliveries and multi-branch reporting.',
         'বক্স/পিস ও স্কয়ার ফিট হিসাব, ব্র্যান্ড ও সাইজ অনুযায়ী স্টক, পাইকারি ও খুচরা দাম, ডিলারের বাকি, ডেলিভারি এবং একাধিক ব্রাঞ্চের রিপোর্ট।'),
      [bi('Box / piece / sq-ft calculation', 'বক্স / পিস / স্কয়ার ফিট হিসাব'), bi('Brand & size-wise stock', 'ব্র্যান্ড ও সাইজ অনুযায়ী স্টক'), bi('Wholesale & retail pricing', 'পাইকারি ও খুচরা দাম'), bi('Dealer due management', 'ডিলারের বাকি ব্যবস্থাপনা'), bi('Multi-branch support', 'একাধিক ব্রাঞ্চ সাপোর্ট')],
      { featured: true }),
    S('erp', '📱', bi('Gadget & Mobile Shop ERP', 'গ্যাজেট ও মোবাইল শপ ইআরপি'),
      bi('IMEI inventory, trade-in and POS for gadget shops.', 'গ্যাজেট শপের জন্য IMEI ইনভেন্টরি, ট্রেড-ইন ও POS।'),
      bi('Track every phone by IMEI, handle trade-ins and warranty, verify bKash/Nagad payments, and connect an online storefront to the same stock.',
         'প্রতিটি ফোন IMEI দিয়ে ট্র্যাক করুন, ট্রেড-ইন ও ওয়ারেন্টি সামলান, বিকাশ/নগদ পেমেন্ট যাচাই করুন এবং একই স্টকের সাথে অনলাইন স্টোর যুক্ত করুন।'),
      [bi('IMEI-wise inventory', 'IMEI অনুযায়ী ইনভেন্টরি'), bi('Trade-in / exchange', 'ট্রেড-ইন / এক্সচেঞ্জ'), bi('Warranty tracking', 'ওয়ারেন্টি ট্র্যাকিং'), bi('bKash / Nagad verification', 'বিকাশ / নগদ যাচাই'), bi('Online store integration', 'অনলাইন স্টোর ইন্টিগ্রেশন')]),
    S('erp', '🍽️', bi('Restaurant Management System', 'রেস্টুরেন্ট ম্যানেজমেন্ট সিস্টেম'),
      bi('POS, kitchen, tables and inventory for restaurants.', 'রেস্টুরেন্টের জন্য POS, কিচেন, টেবিল ও ইনভেন্টরি।'),
      bi('A cloud restaurant system covering POS billing, table and order management, kitchen display, ingredient inventory, staff, expenses and sales reports.',
         'ক্লাউড রেস্টুরেন্ট সিস্টেম: POS বিলিং, টেবিল ও অর্ডার ম্যানেজমেন্ট, কিচেন ডিসপ্লে, উপকরণের ইনভেন্টরি, স্টাফ, খরচ ও বিক্রির রিপোর্ট।'),
      [bi('POS billing', 'POS বিলিং'), bi('Table & order management', 'টেবিল ও অর্ডার ম্যানেজমেন্ট'), bi('Kitchen display', 'কিচেন ডিসপ্লে'), bi('Ingredient inventory', 'উপকরণের ইনভেন্টরি'), bi('Sales & expense reports', 'বিক্রি ও খরচের রিপোর্ট')],
      { featured: true }),
    S('erp', '🖨️', bi('Printing Press Manager', 'প্রিন্টিং প্রেস ম্যানেজার'),
      bi('Orders, plates, media and dues for printing businesses.', 'প্রিন্টিং ব্যবসার অর্ডার, প্লেট, মিডিয়া ও বাকির হিসাব।'),
      bi('Manage CTP plate, PVC media and offset printing jobs, raw material stock, customer orders, payments and dues in one place.',
         'CTP প্লেট, PVC মিডিয়া ও অফসেট প্রিন্টিং কাজ, কাঁচামালের স্টক, কাস্টমারের অর্ডার, পেমেন্ট ও বাকি — এক জায়গায়।'),
      [bi('Job / order tracking', 'জব / অর্ডার ট্র্যাকিং'), bi('Plate & media stock', 'প্লেট ও মিডিয়া স্টক'), bi('Customer dues', 'কাস্টমারের বাকি'), bi('Monthly subscription with free trial', 'ফ্রি ট্রায়ালসহ মাসিক সাবস্ক্রিপশন')]),
    S('erp', '🐄', bi('Livestock Farm ERP', 'গরু-ছাগলের খামার ইআরপি'),
      bi('Cattle & goat farm management in Bangla.', 'বাংলায় গরু-ছাগলের খামার ব্যবস্থাপনা।'),
      bi('Shed-wise animal records, feeding, health, purchase and sale, expenses and profit — with cloud access for multiple users.',
         'শেড অনুযায়ী পশুর রেকর্ড, খাবার, স্বাস্থ্য, ক্রয়-বিক্রয়, খরচ ও লাভ — একাধিক ব্যবহারকারীর জন্য ক্লাউড অ্যাক্সেস।'),
      [bi('Multi-shed management', 'একাধিক শেড ব্যবস্থাপনা'), bi('Animal records', 'পশুর রেকর্ড'), bi('Feed & expense tracking', 'খাবার ও খরচের হিসাব'), bi('Bangla interface', 'বাংলা ইন্টারফেস')],
      { badge: bi('Coming soon', 'শীঘ্রই আসছে') }),
    S('erp', '👕', bi('Garments TQM (ISO 9001)', 'গার্মেন্টস TQM (ISO 9001)'),
      bi('Quality management software for garment factories.', 'গার্মেন্টস কারখানার জন্য কোয়ালিটি ম্যানেজমেন্ট সফটওয়্যার।'),
      bi('Digitise inspections, defects, corrective actions and audit documents to follow ISO 9001 quality processes across your production floor.',
         'ইন্সপেকশন, ডিফেক্ট, সংশোধনমূলক ব্যবস্থা ও অডিট ডকুমেন্ট ডিজিটাল করুন — ISO 9001 মান প্রক্রিয়া মেনে।'),
      [bi('Inspection records', 'ইন্সপেকশন রেকর্ড'), bi('Defect analysis', 'ডিফেক্ট বিশ্লেষণ'), bi('Corrective actions (CAPA)', 'সংশোধনমূলক ব্যবস্থা (CAPA)'), bi('Audit-ready reports', 'অডিট-উপযোগী রিপোর্ট')]),
    S('ecommerce', '🛍️', bi('Custom E-commerce Website', 'কাস্টম ই-কমার্স ওয়েবসাইট'),
      bi('Your own online store, built for your exact needs.', 'আপনার প্রয়োজন অনুযায়ী তৈরি নিজস্ব অনলাইন স্টোর।'),
      bi('Not a template — a full e-commerce website built around your business, with admin panel, bKash/Nagad and cash-on-delivery, courier integration, coupons, Meta Pixel and strong security.',
         'টেমপ্লেট নয় — আপনার ব্যবসা অনুযায়ী তৈরি পূর্ণাঙ্গ ই-কমার্স ওয়েবসাইট: অ্যাডমিন প্যানেল, বিকাশ/নগদ ও ক্যাশ অন ডেলিভারি, কুরিয়ার ইন্টিগ্রেশন, কুপন, মেটা পিক্সেল ও শক্তিশালী নিরাপত্তা।'),
      [bi('Full admin panel', 'সম্পূর্ণ অ্যাডমিন প্যানেল'), bi('bKash / Nagad / COD', 'বিকাশ / নগদ / ক্যাশ অন ডেলিভারি'), bi('Steadfast / courier integration', 'স্টেডফাস্ট / কুরিয়ার ইন্টিগ্রেশন'), bi('Coupons & cashback', 'কুপন ও ক্যাশব্যাক'), bi('Meta Pixel & SEO', 'মেটা পিক্সেল ও SEO'), bi('Abandoned cart monitoring', 'অসম্পূর্ণ কার্ট মনিটরিং')],
      { featured: true }),
    S('ecommerce', '🎯', bi('Single-Product Landing Store', 'সিঙ্গেল-প্রোডাক্ট ল্যান্ডিং স্টোর'),
      bi('High-converting landing page with order system.', 'অর্ডার সিস্টেমসহ বেশি বিক্রির ল্যান্ডিং পেজ।'),
      bi('Perfect for Facebook ad campaigns: one focused product page, quick order form, sales panel, courier booking and pixel tracking.',
         'ফেসবুক অ্যাড ক্যাম্পেইনের জন্য আদর্শ: একটি প্রোডাক্টের ফোকাসড পেজ, দ্রুত অর্ডার ফর্ম, সেলস প্যানেল, কুরিয়ার বুকিং ও পিক্সেল ট্র্যাকিং।'),
      [bi('Quick order form', 'দ্রুত অর্ডার ফর্ম'), bi('Sales team panel', 'সেলস টিম প্যানেল'), bi('Courier booking', 'কুরিয়ার বুকিং'), bi('Pixel tracking', 'পিক্সেল ট্র্যাকিং')]),
    S('ai', '💬', bi('Baybex AI Desk', 'বেবেক্স এআই ডেস্ক'),
      bi('AI auto-reply for Facebook Page, Instagram & WhatsApp.', 'ফেসবুক পেজ, ইনস্টাগ্রাম ও হোয়াটসঅ্যাপে এআই অটো-রিপ্লাই।'),
      bi('Let AI answer customer messages 24/7 in Bangla and English, trained on your products and prices, with an admin panel to manage plans, replies and conversations.',
         'আপনার প্রোডাক্ট ও দাম শিখে এআই ২৪/৭ বাংলা ও ইংরেজিতে কাস্টমারের মেসেজের উত্তর দেবে; প্ল্যান, রিপ্লাই ও কথোপকথন সামলানোর জন্য অ্যাডমিন প্যানেল।'),
      [bi('24/7 instant replies', '২৪/৭ তাৎক্ষণিক উত্তর'), bi('Facebook, Instagram, WhatsApp', 'ফেসবুক, ইনস্টাগ্রাম, হোয়াটসঅ্যাপ'), bi('Bangla & English', 'বাংলা ও ইংরেজি'), bi('Trained on your business', 'আপনার ব্যবসা অনুযায়ী প্রশিক্ষিত')],
      { featured: true }),
    S('ai', '📞', bi('Baybex Oncall', 'বেবেক্স অনকল'),
      bi('Edit this description from the admin panel.', 'অ্যাডমিন প্যানেল থেকে এই বিবরণ লিখুন।'),
      bi('Edit this description from the admin panel.', 'অ্যাডমিন প্যানেল থেকে এই বিবরণ লিখুন।'), [], { visible: false }),
    S('ai', '📈', bi('Baybex Pulse', 'বেবেক্স পালস'),
      bi('Edit this description from the admin panel.', 'অ্যাডমিন প্যানেল থেকে এই বিবরণ লিখুন।'),
      bi('Edit this description from the admin panel.', 'অ্যাডমিন প্যানেল থেকে এই বিবরণ লিখুন।'), [], { visible: false }),
    S('custom', '🌐', bi('Custom Websites', 'কাস্টম ওয়েবসাইট'),
      bi('Business, corporate and portfolio websites.', 'ব্যবসা, কর্পোরেট ও পোর্টফোলিও ওয়েবসাইট।'),
      bi('Fast, secure and mobile-friendly websites for companies, institutions and brands — with an admin panel so you can update content yourself.',
         'কোম্পানি, প্রতিষ্ঠান ও ব্র্যান্ডের জন্য দ্রুত, নিরাপদ ও মোবাইল-বান্ধব ওয়েবসাইট — নিজেই কনটেন্ট আপডেট করার অ্যাডমিন প্যানেলসহ।'),
      [bi('Mobile-friendly design', 'মোবাইল-বান্ধব ডিজাইন'), bi('Admin panel', 'অ্যাডমিন প্যানেল'), bi('SEO ready', 'SEO উপযোগী'), bi('Bangla & English', 'বাংলা ও ইংরেজি')]),
    S('custom', '📲', bi('Custom Mobile Apps', 'কাস্টম মোবাইল অ্যাপ'),
      bi('Native Android apps for your business.', 'আপনার ব্যবসার জন্য নেটিভ অ্যান্ড্রয়েড অ্যাপ।'),
      bi('Native Android apps (Kotlin) that work online or offline, connected to your website or ERP, and ready for Google Play.',
         'অনলাইন বা অফলাইনে চলা নেটিভ অ্যান্ড্রয়েড অ্যাপ (Kotlin), আপনার ওয়েবসাইট বা ইআরপির সাথে যুক্ত এবং গুগল প্লে-তে প্রকাশের উপযোগী।'),
      [bi('Native Android (Kotlin)', 'নেটিভ অ্যান্ড্রয়েড (Kotlin)'), bi('Online & offline', 'অনলাইন ও অফলাইন'), bi('Connects to your ERP / site', 'আপনার ইআরপি / সাইটের সাথে যুক্ত'), bi('Play Store publishing', 'প্লে স্টোরে প্রকাশ')]),
    S('custom', '👤', bi('Personal Branding Website', 'পার্সোনাল ব্র্যান্ডিং ওয়েবসাইট'),
      bi('A professional website for you and your work.', 'আপনার ও আপনার কাজের জন্য পেশাদার ওয়েবসাইট।'),
      bi('For doctors, teachers, creators, consultants and professionals: show your profile, work, achievements and let people contact you.',
         'ডাক্তার, শিক্ষক, কনটেন্ট ক্রিয়েটর, কনসালট্যান্ট ও পেশাজীবীদের জন্য: আপনার প্রোফাইল, কাজ ও অর্জন তুলে ধরুন, মানুষ সহজে যোগাযোগ করুক।'),
      [bi('Profile & portfolio', 'প্রোফাইল ও পোর্টফোলিও'), bi('Blog / updates', 'ব্লগ / আপডেট'), bi('Contact & booking', 'যোগাযোগ ও বুকিং')]),
  ].map((s) => ({ ...s, order: ++order }));

  const highlights = [
    ['🇧🇩', bi('Built for Bangladesh', 'বাংলাদেশের জন্য তৈরি'), bi('Bangla interface, bKash/Nagad, local couriers and local business practices.', 'বাংলা ইন্টারফেস, বিকাশ/নগদ, দেশীয় কুরিয়ার ও স্থানীয় ব্যবসার নিয়ম মেনে।')],
    ['🎯', bi('Made to your needs', 'আপনার প্রয়োজন অনুযায়ী'), bi('We customise every system around how your business actually works.', 'আপনার ব্যবসা যেভাবে চলে, সেভাবেই প্রতিটি সিস্টেম কাস্টমাইজ করা হয়।')],
    ['🔒', bi('Security first', 'নিরাপত্তা সবার আগে'), bi('Role-based access, secure logins and regular backups keep your data safe.', 'রোল-ভিত্তিক অ্যাক্সেস, নিরাপদ লগইন ও নিয়মিত ব্যাকআপে আপনার ডেটা সুরক্ষিত।')],
    ['☁️', bi('Use from anywhere', 'যেকোনো জায়গা থেকে ব্যবহার'), bi('Cloud-based, works on mobile, tablet and computer with multiple users.', 'ক্লাউড-ভিত্তিক; মোবাইল, ট্যাবলেট ও কম্পিউটারে একাধিক ব্যবহারকারী একসাথে।')],
    ['🤝', bi('Local support', 'দেশীয় সাপোর্ট'), bi('Talk to real people in Bangla for setup, training and support.', 'সেটআপ, ট্রেনিং ও সাপোর্টের জন্য বাংলায় সরাসরি কথা বলুন।')],
    ['⚡', bi('Fast delivery', 'দ্রুত ডেলিভারি'), bi('Ready-made solutions get you live quickly, then we fine-tune.', 'রেডিমেড সলিউশনে দ্রুত চালু, তারপর প্রয়োজনমতো উন্নয়ন।')],
  ].map(([icon, title, text], i) => ({ id: uid(), icon, title, text, order: i + 1, visible: true }));

  const steps = [
    [bi('Free consultation', 'ফ্রি পরামর্শ'), bi('Tell us about your business and what you need.', 'আপনার ব্যবসা ও প্রয়োজনের কথা আমাদের জানান।')],
    [bi('Live demo', 'লাইভ ডেমো'), bi('See the software working with your kind of data.', 'আপনার ধরনের ডেটা দিয়ে সফটওয়্যার চলতে দেখুন।')],
    [bi('Customisation', 'কাস্টমাইজেশন'), bi('We adjust features, reports and branding for you.', 'ফিচার, রিপোর্ট ও ব্র্যান্ডিং আপনার মতো করে সাজাই।')],
    [bi('Launch & training', 'চালু ও ট্রেনিং'), bi('We set everything up and train your team.', 'সব সেটআপ করে আপনার টিমকে ট্রেনিং দিই।')],
    [bi('Ongoing support', 'চলমান সাপোর্ট'), bi('Updates, backups and help whenever you need it.', 'আপডেট, ব্যাকআপ ও প্রয়োজনে সবসময় সহায়তা।')],
  ].map(([title, text], i) => ({ id: uid(), title, text, order: i + 1, visible: true }));

  const faqs = [
    [bi('Can the software be customised for my business?', 'আমার ব্যবসা অনুযায়ী কি সফটওয়্যার কাস্টমাইজ করা যাবে?'), bi('Yes. Every Baybex solution can be adjusted — features, reports, invoice design and branding.', 'হ্যাঁ। প্রতিটি বেবেক্স সলিউশন কাস্টমাইজ করা যায় — ফিচার, রিপোর্ট, ইনভয়েস ডিজাইন ও ব্র্যান্ডিং।')],
    [bi('Is the software available in Bangla?', 'সফটওয়্যার কি বাংলায় পাওয়া যায়?'), bi('Yes, our solutions support Bangla and English.', 'হ্যাঁ, আমাদের সলিউশনগুলো বাংলা ও ইংরেজি দুই ভাষাতেই চলে।')],
    [bi('Can I see a demo before buying?', 'কেনার আগে কি ডেমো দেখা যাবে?'), bi('Of course. Request a demo from any solution and we will contact you.', 'অবশ্যই। যেকোনো সলিউশন থেকে ডেমোর অনুরোধ করুন, আমরা যোগাযোগ করব।')],
    [bi('Is my data safe?', 'আমার ডেটা কি নিরাপদ?'), bi('We use secure logins, role-based access and regular backups.', 'আমরা নিরাপদ লগইন, রোল-ভিত্তিক অ্যাক্সেস ও নিয়মিত ব্যাকআপ ব্যবহার করি।')],
    [bi('How do I pay?', 'কীভাবে পেমেন্ট করব?'), bi('You can pay via bKash, Nagad or bank transfer.', 'বিকাশ, নগদ বা ব্যাংক ট্রান্সফারের মাধ্যমে পেমেন্ট করতে পারবেন।')],
  ].map(([q, a], i) => ({ id: uid(), q, a, order: i + 1, visible: true }));

  const settings = {
    siteName: 'BaybexAI',
    logo: '', logoDark: '', favicon: '', // empty = use the built-in Baybex logo files in /assets
    defaultLang: 'bn',
    primaryColor: '#124874', accentColor: '#008390',
    tagline: bi('Software, E-commerce & AI for growing businesses', 'ব্যবসা বাড়াতে সফটওয়্যার, ই-কমার্স ও এআই'),
    heroBadge: bi('ERP • E-commerce • AI Automation', 'ইআরপি • ই-কমার্স • এআই অটোমেশন'),
    heroTitle: bi('Run your whole business from one smart system', 'পুরো ব্যবসা চালান একটি স্মার্ট সিস্টেমে'),
    heroSubtitle: bi('Baybex builds ERP software, custom e-commerce websites and AI automation made for Bangladeshi businesses — in Bangla and English.',
      'বেবেক্স বাংলাদেশি ব্যবসার জন্য তৈরি করে ইআরপি সফটওয়্যার, কাস্টম ই-কমার্স ওয়েবসাইট ও এআই অটোমেশন — বাংলা ও ইংরেজিতে।'),
    heroCta: bi('Explore solutions', 'সলিউশন দেখুন'),
    heroCta2: bi('Get a free demo', 'ফ্রি ডেমো নিন'),
    heroImage: '',
    stats: [
      { value: bi('15+', '১৫+'), label: bi('Ready solutions', 'রেডিমেড সলিউশন') },
      { value: bi('10K+', '১০ হাজার+'), label: bi('Facebook community', 'ফেসবুক কমিউনিটি') },
      { value: bi('2', '২'), label: bi('Languages: Bangla & English', 'ভাষা: বাংলা ও ইংরেজি') },
      { value: bi('Cloud', 'ক্লাউড'), label: bi('Access from anywhere', 'যেকোনো জায়গা থেকে') },
    ],
    aboutTitle: bi('About Baybex', 'বেবেক্স সম্পর্কে'),
    about: bi('Baybex is a Bangladeshi software company building ERP systems, custom e-commerce websites, mobile apps and AI automation. We build each solution around how your business really works — with full features and strong security, not off-the-shelf templates.',
      'বেবেক্স একটি বাংলাদেশি সফটওয়্যার প্রতিষ্ঠান — আমরা তৈরি করি ইআরপি সিস্টেম, কাস্টম ই-কমার্স ওয়েবসাইট, মোবাইল অ্যাপ ও এআই অটোমেশন। প্রতিটি সলিউশন আপনার ব্যবসা যেভাবে চলে সেভাবেই তৈরি — পূর্ণ ফিচার ও শক্তিশালী নিরাপত্তাসহ, রেডিমেড টেমপ্লেট নয়।'),
    phone: '01750006696',
    whatsapp: '8801750006696',
    email: 'bussiness@baybexai.com',
    address: bi('Dhaka, Bangladesh', 'ঢাকা, বাংলাদেশ'),
    facebook: 'https://facebook.com/baybexsolutions',
    youtube: '', linkedin: '', instagram: '',
    officeHours: bi('Sat – Thu, 10am – 8pm', 'শনি – বৃহস্পতি, সকাল ১০টা – রাত ৮টা'),
    footerText: bi('Software, e-commerce and AI solutions for Bangladeshi businesses.', 'বাংলাদেশি ব্যবসার জন্য সফটওয়্যার, ই-কমার্স ও এআই সলিউশন।'),
    seoTitle: bi('BaybexAI — ERP Software, E-commerce & AI Automation in Bangladesh', 'BaybexAI — বাংলাদেশে ইআরপি সফটওয়্যার, ই-কমার্স ও এআই অটোমেশন'),
    seoDescription: bi('Pharmacy, restaurant, tiles, gadget shop and showroom ERP, custom e-commerce websites and AI auto-reply for Facebook & WhatsApp — by Baybex.',
      'ফার্মেসি, রেস্টুরেন্ট, টাইলস, গ্যাজেট শপ ও শোরুম ইআরপি, কাস্টম ই-কমার্স ওয়েবসাইট এবং ফেসবুক ও হোয়াটসঅ্যাপে এআই অটো-রিপ্লাই — বেবেক্স।'),
    ogImage: '',
    announcement: bi('', ''),
    // Tracking & verification (all optional, set from Admin → Site settings)
    ga4Id: '', gtmId: '', metaPixelId: '', metaCapiToken: '', metaTestEventCode: '',
    gscVerification: '', bingVerification: '', fbDomainVerification: '',
    selfAnalytics: true,
    headScripts: '', bodyScripts: '',
    // Local SEO (LocalBusiness schema + map)
    businessType: 'ProfessionalService', legalName: 'Baybex',
    streetAddress: '', city: 'Dhaka', region: 'Dhaka Division', postalCode: '', country: 'BD',
    latitude: '', longitude: '', mapEmbedUrl: '', priceRange: '৳৳',
    openingHoursSchema: 'Sa,Su,Mo,Tu,We,Th 10:00-20:00',
    areaServed: 'Bangladesh',
    sections: { solutions: true, highlights: true, steps: true, about: true, portfolio: true, testimonials: true, blog: true, faq: true, contact: true },
  };


  const posts = [{
    id: uid(), slug: 'how-to-choose-erp-software-for-your-business', published: true, publishedAt: now().slice(0, 10), cover: '', order: 1,
    title: bi('How to choose the right ERP software for your business in Bangladesh', 'বাংলাদেশে আপনার ব্যবসার জন্য সঠিক ইআরপি সফটওয়্যার কীভাবে বাছাই করবেন'),
    excerpt: bi('A practical checklist for shop owners, showrooms, pharmacies and restaurants before buying business software.', 'ব্যবসার সফটওয়্যার কেনার আগে দোকান, শোরুম, ফার্মেসি ও রেস্টুরেন্ট মালিকদের জন্য একটি বাস্তবসম্মত চেকলিস্ট।'),
    content: bi(
`Most businesses start with a notebook and a calculator. That works until stock goes missing, customer dues are forgotten, or you cannot tell which product actually makes a profit. ERP software solves this — but only if you choose the right one.

## 1. Start with your daily work, not the feature list
Write down what happens in your business every day: buying stock, selling, collecting dues, paying suppliers, counting cash. The right software should make **these** jobs faster. Extra features you never use only make the system harder to learn.

## 2. Make sure it fits your industry
A pharmacy needs rack-wise stock and expiry alerts. A tile shop needs box, piece and square-feet calculations. A motorcycle showroom needs chassis and engine numbers. General software usually misses these details — industry-specific software handles them from day one.

## 3. Bangla interface and local payments
Your staff should be comfortable using the system. A Bangla interface, bKash/Nagad payment records and local invoice formats make a big difference in daily use.

## 4. Cloud access with proper user roles
Cloud software lets you check sales from your phone, from anywhere. Role-based access means a salesperson sees only what they need, while the owner sees everything.

## 5. Support, backup and training
Ask who will train your team, how data is backed up, and how quickly problems are fixed. Good local support is worth more than any single feature.

## Quick checklist
- Does it match how your business works today?
- Does it handle your industry's special needs?
- Is there a Bangla interface?
- Can you use it from mobile and computer?
- Are there separate roles for staff?
- Is your data backed up regularly?
- Can you see a live demo first?

Want to see how this looks for your business? [Request a free demo](/contact) and we will show you a system set up for your industry.`,
`বেশিরভাগ ব্যবসা শুরু হয় খাতা আর ক্যালকুলেটর দিয়ে। এভাবে চলে যতদিন না স্টক হারায়, কাস্টমারের বাকি ভুলে যাওয়া হয়, কিংবা কোন পণ্যে আসলে লাভ হচ্ছে বোঝা না যায়। ইআরপি সফটওয়্যার এই সমস্যার সমাধান — তবে শুধু তখনই, যখন সঠিকটি বাছাই করবেন।

## ১. ফিচারের তালিকা নয়, আপনার প্রতিদিনের কাজ দিয়ে শুরু করুন
আপনার ব্যবসায় প্রতিদিন কী কী হয় লিখে ফেলুন: পণ্য কেনা, বিক্রি, বাকি আদায়, সাপ্লায়ারকে পেমেন্ট, ক্যাশ গোনা। সঠিক সফটওয়্যার **এই** কাজগুলোকেই দ্রুত করবে। যে ফিচার কখনো ব্যবহার করবেন না, সেগুলো শুধু সিস্টেম শেখা কঠিন করে।

## ২. আপনার ইন্ডাস্ট্রির সাথে মেলে কিনা দেখুন
ফার্মেসির দরকার র‍্যাক অনুযায়ী স্টক ও মেয়াদের সতর্কতা। টাইলসের দোকানে লাগে বক্স, পিস ও স্কয়ার ফিটের হিসাব। মোটরসাইকেল শোরুমে লাগে চেসিস ও ইঞ্জিন নম্বর। সাধারণ সফটওয়্যারে এগুলো প্রায়ই থাকে না — ইন্ডাস্ট্রি-ভিত্তিক সফটওয়্যার শুরু থেকেই এগুলো সামলায়।

## ৩. বাংলা ইন্টারফেস ও দেশীয় পেমেন্ট
আপনার স্টাফ যেন সহজে ব্যবহার করতে পারে। বাংলা ইন্টারফেস, বিকাশ/নগদ পেমেন্টের রেকর্ড ও দেশীয় ইনভয়েস ফরম্যাট প্রতিদিনের কাজে বড় পার্থক্য আনে।

## ৪. ক্লাউড অ্যাক্সেস ও সঠিক ইউজার রোল
ক্লাউড সফটওয়্যারে যেকোনো জায়গা থেকে মোবাইলে বিক্রি দেখা যায়। রোল-ভিত্তিক অ্যাক্সেসে সেলসম্যান শুধু তার প্রয়োজনীয় অংশ দেখে, আর মালিক দেখেন সবকিছু।

## ৫. সাপোর্ট, ব্যাকআপ ও ট্রেনিং
জিজ্ঞেস করুন কে আপনার টিমকে ট্রেনিং দেবে, ডেটার ব্যাকআপ কীভাবে হয়, আর সমস্যা হলে কত দ্রুত সমাধান হয়। ভালো দেশীয় সাপোর্ট যেকোনো একটি ফিচারের চেয়ে বেশি মূল্যবান।

## দ্রুত চেকলিস্ট
- আপনার ব্যবসা এখন যেভাবে চলে তার সাথে মেলে কি?
- আপনার ইন্ডাস্ট্রির বিশেষ প্রয়োজন সামলায় কি?
- বাংলা ইন্টারফেস আছে কি?
- মোবাইল ও কম্পিউটার দুটো থেকেই চালানো যায় কি?
- স্টাফদের জন্য আলাদা রোল আছে কি?
- ডেটার নিয়মিত ব্যাকআপ হয় কি?
- আগে লাইভ ডেমো দেখা যায় কি?

আপনার ব্যবসার জন্য এটি কেমন হবে দেখতে চান? [ফ্রি ডেমোর অনুরোধ করুন](/contact) — আপনার ইন্ডাস্ট্রির জন্য সাজানো সিস্টেম দেখাব।`),
    seoTitle: bi('How to Choose ERP Software in Bangladesh — 2026 Checklist', 'বাংলাদেশে ইআরপি সফটওয়্যার বাছাইয়ের চেকলিস্ট'),
    seoDescription: bi('A practical checklist to choose ERP software for your shop, pharmacy, showroom or restaurant in Bangladesh: industry fit, Bangla UI, cloud, roles, support.', 'দোকান, ফার্মেসি, শোরুম বা রেস্টুরেন্টের জন্য ইআরপি সফটওয়্যার বাছাইয়ের চেকলিস্ট: ইন্ডাস্ট্রির সাথে মিল, বাংলা ইন্টারফেস, ক্লাউড, রোল ও সাপোর্ট।'),
  }];

  const pages = [{
    id: uid(), slug: 'ecommerce-website-development-bangladesh', visible: true, inFooter: true, showForm: true, image: '', order: 1,
    title: bi('E-commerce Website Development in Bangladesh', 'বাংলাদেশে ই-কমার্স ওয়েবসাইট ডেভেলপমেন্ট'),
    intro: bi('Custom online stores for Bangladeshi businesses — with bKash/Nagad, cash on delivery, courier booking and a full admin panel.', 'বাংলাদেশি ব্যবসার জন্য কাস্টম অনলাইন স্টোর — বিকাশ/নগদ, ক্যাশ অন ডেলিভারি, কুরিয়ার বুকিং ও পূর্ণ অ্যাডমিন প্যানেলসহ।'),
    content: bi(
`Selling only through Facebook messages makes it hard to manage orders, stock and returning customers. Your own e-commerce website gives customers a simple way to order, and gives you one place to manage everything.

## What you get
- A store designed around your products and brand — not a copied template
- Full admin panel: products, orders, customers, coupons and reports
- bKash, Nagad and cash on delivery
- Steadfast and other courier integration
- Meta Pixel and Google Analytics for your ads
- Fast, mobile-friendly and SEO-ready pages
- Bangla and English

## Who it is for
Fashion and saree shops, cosmetics, gadgets, organic food, jewellery, motorcycle parts and any business that wants to sell online across Bangladesh.

## How we work
We start with a free consultation, show you a live demo, customise the store for your products, launch it and train you to run it.`,
`শুধু ফেসবুক মেসেজে বিক্রি করলে অর্ডার, স্টক আর পুরনো কাস্টমার সামলানো কঠিন হয়ে যায়। নিজস্ব ই-কমার্স ওয়েবসাইটে কাস্টমার সহজে অর্ডার করতে পারে, আর আপনি সবকিছু এক জায়গা থেকে সামলাতে পারেন।

## যা পাবেন
- আপনার পণ্য ও ব্র্যান্ড অনুযায়ী ডিজাইন করা স্টোর — কপি করা টেমপ্লেট নয়
- পূর্ণ অ্যাডমিন প্যানেল: পণ্য, অর্ডার, কাস্টমার, কুপন ও রিপোর্ট
- বিকাশ, নগদ ও ক্যাশ অন ডেলিভারি
- স্টেডফাস্ট ও অন্যান্য কুরিয়ার ইন্টিগ্রেশন
- আপনার বিজ্ঞাপনের জন্য মেটা পিক্সেল ও গুগল অ্যানালিটিক্স
- দ্রুত, মোবাইল-বান্ধব ও SEO-উপযোগী পেজ
- বাংলা ও ইংরেজি

## কাদের জন্য
ফ্যাশন ও শাড়ির দোকান, কসমেটিকস, গ্যাজেট, অর্গানিক ফুড, জুয়েলারি, মোটরসাইকেল পার্টস — সারা বাংলাদেশে অনলাইনে বিক্রি করতে চায় এমন যেকোনো ব্যবসা।

## আমরা কীভাবে কাজ করি
ফ্রি পরামর্শ দিয়ে শুরু করি, লাইভ ডেমো দেখাই, আপনার পণ্য অনুযায়ী স্টোর কাস্টমাইজ করি, চালু করি এবং চালানোর ট্রেনিং দিই।`),
    seoTitle: bi('E-commerce Website Development in Bangladesh | Baybex', 'বাংলাদেশে ই-কমার্স ওয়েবসাইট তৈরি | বেবেক্স'),
    seoDescription: bi('Custom e-commerce website development in Bangladesh with bKash/Nagad, COD, courier integration, admin panel and Meta Pixel. Free consultation and demo.', 'বিকাশ/নগদ, ক্যাশ অন ডেলিভারি, কুরিয়ার, অ্যাডমিন প্যানেল ও মেটা পিক্সেলসহ কাস্টম ই-কমার্স ওয়েবসাইট তৈরি। ফ্রি পরামর্শ ও ডেমো।'),
  }];

  const { salt, hash } = hashPassword(CONFIG.DEFAULT_ADMIN_PASS);
  return {
    secret: crypto.randomBytes(32).toString('hex'),
    settings, categories: cats, solutions, highlights, steps, faqs,
    portfolio: [], testimonials: [], posts, pages, redirects: [], leads: [],
    admins: [{ id: uid(), username: CONFIG.DEFAULT_ADMIN_USER, name: 'Administrator', salt, hash, tv: 1, mustChange: true, createdAt: now() }],
    createdAt: now(),
  };
}

/* ============================== POSTGRESQL STORE ==============================
 * The site content is small, so it is kept in memory (fast page renders) and every change
 * is written straight to PostgreSQL. Bilingual content fields are stored as JSONB.
 */
const pool = new Pool({ connectionString: CONFIG.DATABASE_URL, ssl: CONFIG.DB_SSL ? { rejectUnauthorized: false } : false, max: 10 });
pool.on('error', (e) => console.error('Postgres pool error:', e.message));
const CONTENT = ['categories', 'solutions', 'highlights', 'steps', 'portfolio', 'testimonials', 'faqs', 'posts', 'pages', 'redirects'];
const TBL = (c) => 'bx_' + c;
let db;
const mediaDims = new Map(); // '/uploads/x.png' -> {w,h}
const assetDims = new Map(); // '/assets/x.png'  -> {w,h}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS bx_meta (key TEXT PRIMARY KEY, value JSONB NOT NULL);
    CREATE TABLE IF NOT EXISTS bx_admins (
      id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL DEFAULT '',
      salt TEXT NOT NULL, hash TEXT NOT NULL, tv INT NOT NULL DEFAULT 1, must_change BOOLEAN NOT NULL DEFAULT FALSE,
      last_login TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS bx_leads (
      id TEXT PRIMARY KEY, type TEXT NOT NULL DEFAULT 'contact', status TEXT NOT NULL DEFAULT 'new',
      name TEXT NOT NULL, phone TEXT NOT NULL, email TEXT DEFAULT '', company TEXT DEFAULT '', solution TEXT DEFAULT '',
      message TEXT DEFAULT '', note TEXT DEFAULT '', lang TEXT DEFAULT 'bn', ip TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ);
    ALTER TABLE bx_leads ADD COLUMN IF NOT EXISTS utm_source TEXT DEFAULT '';
    ALTER TABLE bx_leads ADD COLUMN IF NOT EXISTS utm_medium TEXT DEFAULT '';
    ALTER TABLE bx_leads ADD COLUMN IF NOT EXISTS utm_campaign TEXT DEFAULT '';
    ALTER TABLE bx_leads ADD COLUMN IF NOT EXISTS page TEXT DEFAULT '';
    ALTER TABLE bx_leads ADD COLUMN IF NOT EXISTS referrer TEXT DEFAULT '';
    CREATE INDEX IF NOT EXISTS bx_leads_created_idx ON bx_leads (created_at DESC);
    CREATE TABLE IF NOT EXISTS bx_media (
      id TEXT PRIMARY KEY, mime TEXT NOT NULL, size INT NOT NULL, data BYTEA NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
    ALTER TABLE bx_media ADD COLUMN IF NOT EXISTS width INT;
    ALTER TABLE bx_media ADD COLUMN IF NOT EXISTS height INT;
    CREATE TABLE IF NOT EXISTS bx_events (
      id BIGSERIAL PRIMARY KEY, ts TIMESTAMPTZ NOT NULL DEFAULT now(), type TEXT NOT NULL, path TEXT NOT NULL DEFAULT '',
      title TEXT DEFAULT '', ref TEXT DEFAULT '', utm_source TEXT DEFAULT '', utm_medium TEXT DEFAULT '', utm_campaign TEXT DEFAULT '',
      visitor TEXT NOT NULL, session TEXT NOT NULL, device TEXT DEFAULT '', browser TEXT DEFAULT '', os TEXT DEFAULT '',
      lang TEXT DEFAULT '', label TEXT DEFAULT '');
    CREATE INDEX IF NOT EXISTS bx_events_ts_idx ON bx_events (ts);
    CREATE INDEX IF NOT EXISTS bx_events_type_ts_idx ON bx_events (type, ts);
  ` + CONTENT.map((c) => `CREATE TABLE IF NOT EXISTS ${TBL(c)} (
      id TEXT PRIMARY KEY, sort INT NOT NULL DEFAULT 0, data JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());`).join('\n'));

  const { rows } = await pool.query(`SELECT 1 FROM bx_meta WHERE key = 'settings'`);
  if (!rows.length) {
    await writeAll(seed());
    console.log(`First run: admin user "${CONFIG.DEFAULT_ADMIN_USER}" / "${CONFIG.DEFAULT_ADMIN_PASS}" — change it after login.`);
  } else {
    // upgrade: add seed posts/pages if those tables are brand new and empty
    for (const c of ['posts', 'pages']) {
      const r = await pool.query(`SELECT count(*)::int n FROM ${TBL(c)}`);
      const m = await pool.query(`SELECT 1 FROM bx_meta WHERE key = $1`, ['seeded_' + c]);
      if (!r.rows[0].n && !m.rows.length) for (const it of seed()[c]) await persistItem(c, it);
      await pool.query(`INSERT INTO bx_meta (key, value) VALUES ($1, 'true') ON CONFLICT DO NOTHING`, ['seeded_' + c]);
    }
  }
  await loadAll();
  const md = await pool.query('SELECT id, width, height FROM bx_media WHERE width IS NOT NULL');
  for (const r of md.rows) mediaDims.set('/uploads/' + r.id, { w: r.width, h: r.height });
  for (const f of fs.readdirSync(path.join(CONFIG.PUBLIC_DIR, 'assets'))) {
    try { const d = sizeOf(path.join(CONFIG.PUBLIC_DIR, 'assets', f)); assetDims.set('/assets/' + f, { w: d.width, h: d.height }); } catch {}
  }
}

const iso = (d) => (d ? new Date(d).toISOString() : undefined);
async function loadAll() {
  const next = {};
  const meta = await pool.query('SELECT key, value FROM bx_meta');
  for (const r of meta.rows) next[r.key] = r.value;
  const def = seed().settings;
  next.settings = { ...def, ...(next.settings || {}), sections: { ...def.sections, ...((next.settings || {}).sections || {}) } };
  for (const c of CONTENT) {
    const r = await pool.query(`SELECT id, sort, data, created_at, updated_at FROM ${TBL(c)} ORDER BY sort, created_at`);
    next[c] = r.rows.map((x) => ({ ...x.data, id: x.id, order: x.sort, createdAt: iso(x.created_at), updatedAt: iso(x.updated_at) }));
  }
  const L = await pool.query('SELECT * FROM bx_leads ORDER BY created_at DESC');
  next.leads = L.rows.map(leadFromRow);
  const Ad = await pool.query('SELECT * FROM bx_admins ORDER BY created_at');
  next.admins = Ad.rows.map((x) => ({ id: x.id, username: x.username, name: x.name, salt: x.salt, hash: x.hash, tv: x.tv,
    mustChange: x.must_change, lastLogin: iso(x.last_login), createdAt: iso(x.created_at) }));
  db = next;
}
const leadFromRow = (x) => ({ id: x.id, type: x.type, status: x.status, name: x.name, phone: x.phone, email: x.email, company: x.company,
  solution: x.solution, message: x.message, note: x.note, lang: x.lang, ip: x.ip, utmSource: x.utm_source, utmMedium: x.utm_medium,
  utmCampaign: x.utm_campaign, page: x.page, referrer: x.referrer, createdAt: iso(x.created_at), updatedAt: iso(x.updated_at) });

const itemData = (it) => { const { id, order, createdAt, updatedAt, ...data } = it; return data; };
async function persistSettings(q = pool) {
  await q.query(`INSERT INTO bx_meta (key, value) VALUES ('settings', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(db.settings)]);
}
async function persistItem(c, it, q = pool) {
  await q.query(`INSERT INTO ${TBL(c)} (id, sort, data, created_at, updated_at) VALUES ($1,$2,$3,COALESCE($4::timestamptz, now()), now())
    ON CONFLICT (id) DO UPDATE SET sort = EXCLUDED.sort, data = EXCLUDED.data, updated_at = now()`,
    [it.id, Number(it.order) || 0, JSON.stringify(itemData(it)), it.createdAt || null]);
}
async function removeItem(c, id) { await pool.query(`DELETE FROM ${TBL(c)} WHERE id = $1`, [id]); }
async function persistOrder(c) {
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    for (const it of db[c]) await cl.query(`UPDATE ${TBL(c)} SET sort = $2 WHERE id = $1`, [it.id, Number(it.order) || 0]);
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK'); throw e; } finally { cl.release(); }
}
async function persistLead(l, q = pool) {
  await q.query(`INSERT INTO bx_leads (id, type, status, name, phone, email, company, solution, message, note, lang, ip,
      utm_source, utm_medium, utm_campaign, page, referrer, created_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,COALESCE($18::timestamptz, now()),$19)
    ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, updated_at = EXCLUDED.updated_at`,
    [l.id, l.type, l.status, l.name, l.phone, l.email || '', l.company || '', l.solution || '', l.message || '', l.note || '', l.lang || 'bn', l.ip || '',
      l.utmSource || '', l.utmMedium || '', l.utmCampaign || '', l.page || '', l.referrer || '', l.createdAt || null, l.updatedAt || null]);
}
async function removeLead(id) { await pool.query('DELETE FROM bx_leads WHERE id = $1', [id]); }
async function persistAdmin(a, q = pool) {
  await q.query(`INSERT INTO bx_admins (id, username, name, salt, hash, tv, must_change, last_login, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,COALESCE($9::timestamptz, now()))
    ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username, name = EXCLUDED.name, salt = EXCLUDED.salt, hash = EXCLUDED.hash,
      tv = EXCLUDED.tv, must_change = EXCLUDED.must_change, last_login = EXCLUDED.last_login`,
    [a.id, a.username, a.name || '', a.salt, a.hash, a.tv || 1, !!a.mustChange, a.lastLogin || null, a.createdAt || null]);
}
async function removeAdmin(id) { await pool.query('DELETE FROM bx_admins WHERE id = $1', [id]); }
// Replace everything (first run + restore) in one transaction. Uploaded images and analytics are not touched.
async function writeAll(data) {
  const cl = await pool.connect();
  try {
    await cl.query('BEGIN');
    await cl.query(`TRUNCATE bx_admins, bx_leads, ${CONTENT.map(TBL).join(', ')}`);
    await cl.query(`INSERT INTO bx_meta (key, value) VALUES ('secret', $1), ('settings', $2), ('seeded_posts', 'true'), ('seeded_pages', 'true')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [JSON.stringify(data.secret), JSON.stringify(data.settings)]);
    for (const c of CONTENT) for (const it of data[c] || []) await persistItem(c, it, cl);
    for (const l of data.leads || []) await persistLead(l, cl);
    for (const a of data.admins || []) await persistAdmin(a, cl);
    await cl.query('COMMIT');
  } catch (e) { await cl.query('ROLLBACK'); throw e; } finally { cl.release(); }
}

/* ============================== SANITISING ============================== */
const COLLECTIONS = {
  categories: ['name', 'icon', 'order', 'description', 'seoTitle', 'seoDescription'],
  solutions: ['slug', 'category', 'icon', 'name', 'short', 'description', 'features', 'price', 'priceValue', 'image', 'gallery', 'demoUrl', 'badge', 'featured', 'visible', 'order', 'seoTitle', 'seoDescription'],
  highlights: ['icon', 'title', 'text', 'order', 'visible'],
  steps: ['title', 'text', 'order', 'visible'],
  portfolio: ['title', 'text', 'image', 'url', 'category', 'order', 'visible'],
  testimonials: ['name', 'role', 'text', 'photo', 'rating', 'order', 'visible'],
  faqs: ['q', 'a', 'order', 'visible'],
  posts: ['title', 'slug', 'excerpt', 'content', 'cover', 'published', 'publishedAt', 'seoTitle', 'seoDescription', 'order'],
  pages: ['title', 'slug', 'intro', 'content', 'image', 'showForm', 'inFooter', 'visible', 'seoTitle', 'seoDescription', 'order'],
  redirects: ['from', 'to', 'code', 'order'],
};
const RESERVED = ['solutions', 'category', 'blog', 'contact', 'admin', 'api', 'uploads', 'assets', 'en', 'bn', 'sitemap.xml', 'robots.txt', 'rss.xml', 'lead'];
function clean(v, depth = 0) {
  if (depth > 5) return null;
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v.slice(0, 60000);
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'boolean') return v;
  if (Array.isArray(v)) return v.slice(0, 200).map((x) => clean(x, depth + 1));
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v).slice(0, 100)) if (!k.startsWith('__') && k !== 'constructor' && k !== 'prototype') o[k] = clean(v[k], depth + 1);
    return o;
  }
  return '';
}
const pick = (obj, keys) => {
  const o = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) o[k] = clean(obj[k]);
  return o;
};
const SLUG_BASE = { solutions: '/solutions/', posts: '/blog/', pages: '/' };
function normalise(name, item) {
  if (SLUG_BASE[name]) {
    item.slug = slugify(item.slug || item.title?.en || item.name?.en || item.title?.bn || item.name?.bn);
    if (name === 'pages' && RESERVED.includes(item.slug)) item.slug += '-page';
    if (db[name].some((s) => s.slug === item.slug && s.id !== item.id)) item.slug += '-' + uid().slice(0, 4);
  }
  if (name === 'solutions') {
    item.image = safeUrl(item.image); item.demoUrl = safeUrl(item.demoUrl);
    if (!Array.isArray(item.features)) item.features = [];
    item.gallery = (Array.isArray(item.gallery) ? item.gallery : []).map(safeUrl).filter(Boolean);
    item.priceValue = Math.max(0, Number(item.priceValue) || 0);
  }
  if (name === 'posts') { item.cover = safeUrl(item.cover); if (!/^\d{4}-\d{2}-\d{2}/.test(item.publishedAt || '')) item.publishedAt = now().slice(0, 10); }
  if (name === 'pages') item.image = safeUrl(item.image);
  if (name === 'portfolio') { item.image = safeUrl(item.image); item.url = safeUrl(item.url); }
  if (name === 'testimonials') { item.photo = safeUrl(item.photo); item.rating = Math.max(1, Math.min(5, Number(item.rating) || 5)); }
  if (name === 'redirects') {
    let f = String(item.from || '').trim();
    try { f = new URL(f, CONFIG.SITE_URL).pathname; } catch {}
    f = decodeSafe(f).replace(/^\/(en|bn)(?=\/|$)/, '') || '/';
    if (f.length > 1) f = f.replace(/\/+$/, '');
    item.from = f;
    item.code = ['301', '302', '410'].includes(String(item.code)) ? String(item.code) : '301';
    item.to = item.code === '410' ? '' : safeUrl(item.to);
  }
}
const decodeSafe = (s) => { try { return decodeURIComponent(s); } catch { return s; } };
async function addRedirect(from, to, code = '301') {
  // drop any old rule for this path, and any rule that would redirect away from the new live URL
  const drop = db.redirects.filter((r) => r.from === from || (to && r.from === to));
  db.redirects = db.redirects.filter((r) => !drop.includes(r));
  for (const r of drop) await removeItem('redirects', r.id);
  // avoid chains: anything pointing at `from` now points at `to`
  for (const r of db.redirects) if (r.to === from && code !== '410') { r.to = to; await persistItem('redirects', r); }
  const it = { id: uid(), from, to, code, order: db.redirects.length + 1, createdAt: now() };
  await persistItem('redirects', it); db.redirects.push(it);
}

/* ============================== SESSIONS ============================== */
const COOKIE = 'bxa_session';
function sign(data) { return crypto.createHmac('sha256', db.secret).update(data).digest('base64url'); }
function makeToken(admin) {
  const payload = Buffer.from(JSON.stringify({ id: admin.id, tv: admin.tv, exp: Date.now() + CONFIG.SESSION_HOURS * 3600e3 })).toString('base64url');
  return payload + '.' + sign(payload);
}
function readToken(tok) {
  if (!tok || !tok.includes('.')) return null;
  const [p, s] = tok.split('.');
  const exp = sign(p);
  if (s.length !== exp.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(exp))) return null;
  try {
    const d = JSON.parse(Buffer.from(p, 'base64url').toString());
    if (d.exp < Date.now()) return null;
    const a = db.admins.find((x) => x.id === d.id);
    return a && a.tv === d.tv ? a : null;
  } catch { return null; }
}
function cookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((c) => {
    const i = c.indexOf('=');
    if (i > 0) out[c.slice(0, i).trim()] = decodeSafe(c.slice(i + 1).trim());
  });
  return out;
}
function setSession(req, res, token, maxAgeSec) {
  const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (req.secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function auth(req, res, next) {
  const a = readToken(cookies(req)[COOKIE]);
  if (!a) return res.status(401).json({ error: 'Not logged in' });
  req.admin = a;
  next();
}
function sameOrigin(req, res, next) {
  if (req.method === 'GET') return next();
  const origin = req.headers.origin;
  try { if (origin && new URL(origin).host !== req.headers.host) return res.status(403).json({ error: 'Bad origin' }); } catch { return res.status(403).json({ error: 'Bad origin' }); }
  next();
}

/* ============================== RATE LIMIT ============================== */
const hits = new Map();
function limited(key, max, windowMs) {
  const t = Date.now();
  const arr = (hits.get(key) || []).filter((x) => t - x < windowMs);
  arr.push(t);
  hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const t = Date.now(); for (const [k, v] of hits) if (!v.some((x) => t - x < 3600e3)) hits.delete(k); }, 600e3).unref();

/* ============================== i18n (website UI) ============================== */
const UI = {
  en: { home: 'Home', nav_solutions: 'Solutions', nav_blog: 'Blog', nav_about: 'About', nav_faq: 'FAQ', nav_contact: 'Contact',
    get_demo: 'Get a demo', all: 'All', details: 'View details', request_demo: 'Request a free demo', live_demo: 'View live demo',
    sol_k: 'Our Solutions', sol_h: 'Everything your business needs', sol_p: 'ERP software, e-commerce, AI automation and custom development — ready to use and made to fit.',
    why_k: 'Why Baybex', why_h: 'Built for how you actually work', why_p: 'Practical software that fits Bangladeshi businesses.',
    steps_k: 'How it works', steps_h: 'From first call to go-live', steps_p: 'A simple process to get you up and running.',
    pf_k: 'Portfolio', pf_h: 'Some of our work', pf_p: 'Projects we have delivered.',
    tm_k: 'Testimonials', tm_h: 'What clients say',
    blog_k: 'Blog', blog_h: 'Guides & insights', blog_p: 'Practical articles to help you run and grow your business.',
    faq_k: 'FAQ', faq_h: 'Frequently asked questions',
    ct_k: 'Contact', ct_h: "Let's talk about your business", ct_p: 'Tell us what you need — we will get back to you quickly.',
    phone: 'Phone', email: 'Email', address: 'Address', hours: 'Office hours', whatsapp: 'WhatsApp', call: 'Call now',
    f_name: 'Your name', f_phone: 'Phone number', f_email: 'Email (optional)', f_company: 'Business name', f_solution: 'Interested in', f_any: 'Not sure yet', f_msg: 'Message', f_send: 'Send message', f_sending: 'Sending…',
    ok: 'Thank you! We received your message and will contact you soon.', err: 'Please enter your name and a valid phone number.', err_many: 'Too many requests. Please try again later.', err_net: 'Could not send. Please call or WhatsApp us.',
    quick: 'Quick links', sol_f: 'Solutions', rights: 'All rights reserved.', features: 'Key features', gallery: 'Screenshots', featured: 'Popular',
    price: 'Pricing', related: 'Related solutions', all_solutions: 'All solutions', read_more: 'Read more', min_read: 'min read', latest: 'Latest articles', view_all: 'View all',
    prev: '← Newer', next: 'Older →', page: 'Page', nf_t: 'Page not found', nf_p: 'The page you are looking for does not exist or has moved.', gone_t: 'This page has been removed',
    back_home: 'Back to home', solutions_in: 'solutions', more_posts: 'More articles', interested: 'Interested in this?', interested_p: 'Get a free consultation and live demo.',
    map: 'Location map', menu: 'Menu', skip: 'Skip to content', lang_name: 'English', other_lang: 'বাংলা', breadcrumb: 'Breadcrumb', published: 'Published', updated: 'Updated' },
  bn: { home: 'হোম', nav_solutions: 'সলিউশন', nav_blog: 'ব্লগ', nav_about: 'আমাদের সম্পর্কে', nav_faq: 'প্রশ্নোত্তর', nav_contact: 'যোগাযোগ',
    get_demo: 'ডেমো নিন', all: 'সব', details: 'বিস্তারিত দেখুন', request_demo: 'ফ্রি ডেমোর অনুরোধ', live_demo: 'লাইভ ডেমো দেখুন',
    sol_k: 'আমাদের সলিউশন', sol_h: 'আপনার ব্যবসার যা যা দরকার', sol_p: 'ইআরপি সফটওয়্যার, ই-কমার্স, এআই অটোমেশন ও কাস্টম ডেভেলপমেন্ট — ব্যবহারের জন্য প্রস্তুত, আপনার মতো করে সাজানো।',
    why_k: 'কেন বেবেক্স', why_h: 'আপনার কাজের ধরন বুঝে তৈরি', why_p: 'বাংলাদেশি ব্যবসার উপযোগী বাস্তবসম্মত সফটওয়্যার।',
    steps_k: 'কীভাবে কাজ করি', steps_h: 'প্রথম কল থেকে চালু হওয়া পর্যন্ত', steps_p: 'সহজ কয়েকটি ধাপে আপনার সিস্টেম চালু।',
    pf_k: 'পোর্টফোলিও', pf_h: 'আমাদের কিছু কাজ', pf_p: 'আমাদের সম্পন্ন করা প্রজেক্ট।',
    tm_k: 'গ্রাহকের মতামত', tm_h: 'গ্রাহকরা যা বলেন',
    blog_k: 'ব্লগ', blog_h: 'গাইড ও পরামর্শ', blog_p: 'আপনার ব্যবসা চালানো ও বাড়ানোর জন্য কাজের লেখা।',
    faq_k: 'প্রশ্নোত্তর', faq_h: 'সচরাচর জিজ্ঞাসিত প্রশ্ন',
    ct_k: 'যোগাযোগ', ct_h: 'আপনার ব্যবসা নিয়ে কথা বলি', ct_p: 'আপনার প্রয়োজন জানান — আমরা দ্রুত যোগাযোগ করব।',
    phone: 'ফোন', email: 'ইমেইল', address: 'ঠিকানা', hours: 'অফিস সময়', whatsapp: 'হোয়াটসঅ্যাপ', call: 'এখনই কল করুন',
    f_name: 'আপনার নাম', f_phone: 'মোবাইল নম্বর', f_email: 'ইমেইল (ঐচ্ছিক)', f_company: 'ব্যবসার নাম', f_solution: 'যে সলিউশনে আগ্রহী', f_any: 'এখনো নিশ্চিত নই', f_msg: 'বার্তা', f_send: 'বার্তা পাঠান', f_sending: 'পাঠানো হচ্ছে…',
    ok: 'ধন্যবাদ! আপনার বার্তা পেয়েছি, শীঘ্রই যোগাযোগ করব।', err: 'অনুগ্রহ করে নাম ও সঠিক মোবাইল নম্বর দিন।', err_many: 'অনেকবার চেষ্টা করা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।', err_net: 'পাঠানো যায়নি। অনুগ্রহ করে কল বা হোয়াটসঅ্যাপ করুন।',
    quick: 'দ্রুত লিংক', sol_f: 'সলিউশন', rights: 'সর্বস্বত্ব সংরক্ষিত।', features: 'মূল ফিচারসমূহ', gallery: 'স্ক্রিনশট', featured: 'জনপ্রিয়',
    price: 'মূল্য', related: 'সম্পর্কিত সলিউশন', all_solutions: 'সব সলিউশন', read_more: 'আরও পড়ুন', min_read: 'মিনিটের পড়া', latest: 'সাম্প্রতিক লেখা', view_all: 'সব দেখুন',
    prev: '← নতুন', next: 'পুরোনো →', page: 'পৃষ্ঠা', nf_t: 'পেজটি পাওয়া যায়নি', nf_p: 'আপনি যে পেজটি খুঁজছেন সেটি নেই বা সরিয়ে নেওয়া হয়েছে।', gone_t: 'এই পেজটি সরিয়ে ফেলা হয়েছে',
    back_home: 'হোমে ফিরে যান', solutions_in: 'টি সলিউশন', more_posts: 'আরও লেখা', interested: 'আগ্রহী?', interested_p: 'ফ্রি পরামর্শ ও লাইভ ডেমো নিন।',
    map: 'লোকেশন ম্যাপ', menu: 'মেনু', skip: 'মূল কনটেন্টে যান', lang_name: 'বাংলা', other_lang: 'English', breadcrumb: 'ব্রেডক্রাম্ব', published: 'প্রকাশিত', updated: 'হালনাগাদ' },
};

/* ============================== SEO / RENDER HELPERS ============================== */
const LANGS = ['bn', 'en'];
const DEF = () => (db.settings.defaultLang === 'en' ? 'en' : 'bn');
const OTHER = (l) => (l === 'bn' ? 'en' : 'bn');
const L = (lang, p = '/') => (lang === DEF() ? p : '/' + lang + (p === '/' ? '' : p));
const abs = (p) => CONFIG.SITE_URL + encodeURI(p);
const absAsset = (u) => (!u ? '' : /^https?:\/\//.test(u) ? u : CONFIG.SITE_URL + u);
const LOGO = () => safeUrl(db.settings.logo) || '/assets/logo-horizontal-sm.webp';
const LOGO_DARK = () => safeUrl(db.settings.logoDark) || '/assets/logo-horizontal-white-sm.webp';
const dims = (u) => assetDims.get(u) || mediaDims.get(u);
function img(src, alt, o = {}) {
  src = safeUrl(src);
  if (!src) return '';
  const d = dims(src);
  return `<img src="${esc(src)}" alt="${esc(alt)}"${d ? ` width="${d.w}" height="${d.h}"` : ''}${o.eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"${o.cls ? ` class="${o.cls}"` : ''}${o.style ? ` style="${o.style}"` : ''}>`;
}
const bnDigits = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
function ctxFor(lang) {
  const t = (o) => (o && typeof o === 'object' ? (o[lang] || o[OTHER(lang)] || '') : (o || ''));
  const u = (k) => UI[lang][k] || UI.en[k] || '';
  const num = (n) => (lang === 'bn' ? bnDigits(n) : String(n));
  const date = (d) => { try { return new Date(d).toLocaleDateString(lang === 'bn' ? 'bn-BD' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: CONFIG.TIMEZONE }); } catch { return d; } };
  return { lang, t, u, num, date, L: (p) => L(lang, p) };
}
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : s; };
const stripMd = (s) => String(s || '').replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[#>*`_-]+/g, ' ');

// Tiny, safe Markdown → HTML (headings, paragraphs, lists, quotes, bold, italic, code, links, images)
function md(src, c) {
  const inline = (s) => esc(s)
    .replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, a, u) => img(safeUrl(u.replace(/&amp;/g, '&')), a.replace(/&[^;]+;/g, ''), {}) || '')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, txt, u0) => {
      let u = safeUrl(u0.replace(/&amp;/g, '&'));
      if (!u) return txt;
      const ext = /^https?:\/\//.test(u) && !u.startsWith(CONFIG.SITE_URL);
      if (!ext && u.startsWith('/') && c && c.lang !== DEF()) u = c.L(u);
      return `<a href="${esc(u)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${txt}</a>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  const out = []; let para = [], list = null, quote = [];
  const flushP = () => { if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`); para = []; };
  const flushL = () => { if (list) out.push(`<${list.t}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.t}>`); list = null; };
  const flushQ = () => { if (quote.length) out.push(`<blockquote>${inline(quote.join(' '))}</blockquote>`); quote = []; };
  const flush = () => { flushP(); flushL(); flushQ(); };
  for (const raw of String(src || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trim();
    let m;
    if (!line) { flush(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.+)$/))) { flush(); const lv = Math.min(4, Math.max(2, m[1].length + (m[1].length === 1 ? 1 : 0))); out.push(`<h${lv} id="${esc(slugify(m[2]))}">${inline(m[2])}</h${lv}>`); continue; }
    if ((m = line.match(/^[-*]\s+(.+)$/))) { flushP(); flushQ(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^\d+[.)]\s+(.+)$/)) || (m = line.match(/^[০-৯]+[.)]\s+(.+)$/))) { flushP(); flushQ(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushP(); flushL(); quote.push(m[1]); continue; }
    flushL(); flushQ(); para.push(line);
  }
  flush();
  return out.join('\n');
}
const readMins = (s) => Math.max(1, Math.round(String(s || '').split(/\s+/).filter(Boolean).length / 200));

/* ---------- JSON-LD ---------- */
const ORG_ID = () => CONFIG.SITE_URL + '/#organization';
function orgLd() {
  const S = db.settings;
  const logo = absAsset(safeUrl(S.logo) || '/assets/logo-full.png');
  const ld = { '@context': 'https://schema.org', '@type': 'Organization', '@id': ORG_ID(), name: S.siteName, legalName: S.legalName || undefined,
    url: CONFIG.SITE_URL + '/', logo: { '@type': 'ImageObject', url: logo }, email: S.email || undefined, telephone: S.phone ? '+880' + String(S.phone).replace(/\D/g, '').replace(/^0/, '') : undefined,
    sameAs: [S.facebook, S.youtube, S.linkedin, S.instagram].map(safeUrl).filter(Boolean),
    contactPoint: S.phone ? [{ '@type': 'ContactPoint', telephone: '+880' + String(S.phone).replace(/\D/g, '').replace(/^0/, ''), contactType: 'sales', areaServed: 'BD', availableLanguage: ['Bengali', 'English'] }] : undefined };
  return ld;
}
function localLd(c) {
  const S = db.settings;
  const ld = { '@context': 'https://schema.org', '@type': S.businessType || 'ProfessionalService', '@id': CONFIG.SITE_URL + '/#localbusiness',
    name: S.siteName, url: CONFIG.SITE_URL + '/', image: absAsset(safeUrl(S.ogImage) || '/assets/og-image.jpg'), logo: absAsset(safeUrl(S.logo) || '/assets/logo-full.png'),
    telephone: orgLd().telephone, email: S.email || undefined, priceRange: S.priceRange || undefined, description: c.t(S.seoDescription),
    address: { '@type': 'PostalAddress', streetAddress: S.streetAddress || undefined, addressLocality: S.city || undefined, addressRegion: S.region || undefined, postalCode: S.postalCode || undefined, addressCountry: S.country || 'BD' },
    areaServed: S.areaServed || undefined, openingHours: S.openingHoursSchema || undefined, parentOrganization: { '@id': ORG_ID() },
    sameAs: orgLd().sameAs };
  if (S.latitude && S.longitude) ld.geo = { '@type': 'GeoCoordinates', latitude: Number(S.latitude), longitude: Number(S.longitude) };
  return ld;
}
const websiteLd = (c) => ({ '@context': 'https://schema.org', '@type': 'WebSite', '@id': CONFIG.SITE_URL + '/#website', url: abs(c.L('/')), name: db.settings.siteName,
  inLanguage: c.lang === 'bn' ? 'bn-BD' : 'en', publisher: { '@id': ORG_ID() } });
const breadcrumbLd = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList',
  itemListElement: items.map((x, i) => ({ '@type': 'ListItem', position: i + 1, name: x.name, item: abs(x.url) })) });
const faqLd = (c, faqs) => ({ '@context': 'https://schema.org', '@type': 'FAQPage',
  mainEntity: faqs.map((f) => ({ '@type': 'Question', name: c.t(f.q), acceptedAnswer: { '@type': 'Answer', text: c.t(f.a) } })) });
const itemListLd = (c, list) => ({ '@context': 'https://schema.org', '@type': 'ItemList',
  itemListElement: list.map((s, i) => ({ '@type': 'ListItem', position: i + 1, url: abs(c.L('/solutions/' + s.slug)), name: c.t(s.name) })) });

/* ---------- Tracking snippets ---------- */
const validGA = (x) => /^G-[A-Z0-9]{4,20}$/i.test(x || '');
const validGTM = (x) => /^GTM-[A-Z0-9]{4,12}$/i.test(x || '');
const validPixel = (x) => /^\d{5,20}$/.test(x || '');
function trackingHead() {
  const S = db.settings; let h = '';
  if (validGTM(S.gtmId)) h += `<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer','${S.gtmId}');</script>\n`;
  if (validGA(S.ga4Id)) h += `<script async src="https://www.googletagmanager.com/gtag/js?id=${S.ga4Id}"></script><script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${S.ga4Id}');</script>\n`;
  if (validPixel(S.metaPixelId)) h += `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${S.metaPixelId}');fbq('track','PageView');</script>\n`;
  return h;
}
function trackingBody() {
  const S = db.settings; let h = '';
  if (validGTM(S.gtmId)) h += `<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${S.gtmId}" height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>`;
  if (validPixel(S.metaPixelId)) h += `<noscript><img height="1" width="1" style="display:none" alt="" src="https://www.facebook.com/tr?id=${S.metaPixelId}&ev=PageView&noscript=1"></noscript>`;
  return h;
}

/* ---------- CSS (inlined: no render-blocking stylesheet request) ---------- */
function css() {
  const S = db.settings;
  const P = /^#[0-9a-f]{3,8}$/i.test(S.primaryColor) ? S.primaryColor : '#124874';
  const A = /^#[0-9a-f]{3,8}$/i.test(S.accentColor) ? S.accentColor : '#008390';
  return `
@font-face{font-family:'Jakarta';font-style:normal;font-weight:400;font-display:swap;src:url(/assets/fonts/plus-jakarta-sans-latin-400-normal.woff2) format('woff2')}
@font-face{font-family:'Jakarta';font-style:normal;font-weight:600;font-display:swap;src:url(/assets/fonts/plus-jakarta-sans-latin-600-normal.woff2) format('woff2')}
@font-face{font-family:'Jakarta';font-style:normal;font-weight:700;font-display:swap;src:url(/assets/fonts/plus-jakarta-sans-latin-700-normal.woff2) format('woff2')}
@font-face{font-family:'Jakarta';font-style:normal;font-weight:800;font-display:swap;src:url(/assets/fonts/plus-jakarta-sans-latin-800-normal.woff2) format('woff2')}
@font-face{font-family:'Hind';font-style:normal;font-weight:400;font-display:swap;src:url(/assets/fonts/hind-siliguri-bengali-400-normal.woff2) format('woff2');unicode-range:U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1}
@font-face{font-family:'Hind';font-style:normal;font-weight:600;font-display:swap;src:url(/assets/fonts/hind-siliguri-bengali-600-normal.woff2) format('woff2');unicode-range:U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1}
@font-face{font-family:'Hind';font-style:normal;font-weight:700;font-display:swap;src:url(/assets/fonts/hind-siliguri-bengali-700-normal.woff2) format('woff2');unicode-range:U+0951-0952,U+0964-0965,U+0980-09FE,U+1CD0,U+1CD2,U+1CD5-1CD6,U+1CD8,U+1CE1,U+1CEA,U+1CED,U+1CF2,U+1CF5-1CF7,U+200C-200D,U+20B9,U+25CC,U+A8F1}
:root{--p:${P};--a:${A};--ink:#0f172a;--mut:#536173;--line:#e5eaf1;--bg:#f5f8fb;--r:18px}
*{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth;-webkit-text-size-adjust:100%}
body{font-family:'Jakarta','Hind',system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);background:#fff;line-height:1.65;-webkit-font-smoothing:antialiased}
html[lang^=bn] body{font-family:'Hind','Jakarta',system-ui,sans-serif;line-height:1.75}
a{color:inherit;text-decoration:none}
img{max-width:100%;height:auto;display:block}
button{font:inherit;cursor:pointer;border:0;background:none;color:inherit}
.skip{position:absolute;left:-999px;top:8px;background:var(--p);color:#fff;padding:8px 14px;border-radius:8px;z-index:200}.skip:focus{left:8px}
:focus-visible{outline:3px solid var(--a);outline-offset:2px}
.wrap{max-width:1200px;margin:0 auto;padding:0 20px}
.btn{display:inline-flex;align-items:center;gap:8px;padding:13px 22px;border-radius:999px;font-weight:700;transition:.2s;white-space:nowrap;justify-content:center}
.btn-a{background:var(--a);color:#fff;box-shadow:0 8px 24px -10px var(--a)}.btn-a:hover{transform:translateY(-2px);filter:brightness(1.07)}
.btn-o{border:1.5px solid rgba(255,255,255,.4);color:#fff}.btn-o:hover{background:rgba(255,255,255,.1)}
.btn-l{border:1.5px solid var(--line);color:var(--p);background:#fff}.btn-l:hover{border-color:var(--a);color:var(--a)}
.ann{background:var(--a);color:#fff;text-align:center;font-size:14px;padding:8px 16px;font-weight:600}
header.top{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.94);backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.nav{display:flex;align-items:center;gap:22px;height:72px}
.brand{display:flex;align-items:center;flex:none}.brand img{height:46px;width:auto}
.links{display:flex;gap:24px;margin-left:auto;font-weight:600;font-size:15px;color:#334155}.links a:hover,.links a[aria-current]{color:var(--a)}
.lsw{border:1.5px solid var(--line);border-radius:999px;padding:6px 14px;font-size:13.5px;font-weight:700;color:var(--p)}.lsw:hover{border-color:var(--a)}
.burger{display:none;font-size:26px;color:var(--p);padding:6px}
@media(max-width:940px){.links{display:none;position:absolute;top:72px;left:0;right:0;background:#fff;flex-direction:column;padding:16px 20px;gap:14px;border-bottom:1px solid var(--line)}.links.open{display:flex}.burger{display:block}.nav .btn-a{display:none}.lsw{margin-left:auto}}
.hero{background:radial-gradient(900px 480px at 85% -10%,color-mix(in srgb,var(--a) 38%,transparent),transparent 60%),linear-gradient(160deg,var(--p),color-mix(in srgb,var(--p) 78%,#000));color:#fff;padding:84px 0 108px;position:relative;overflow:hidden}
.hero:after{content:"";position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:48px 48px;-webkit-mask-image:linear-gradient(180deg,#000,transparent);mask-image:linear-gradient(180deg,#000,transparent);pointer-events:none}
.hero .wrap{position:relative;z-index:1;display:grid;grid-template-columns:1.15fr .85fr;gap:48px;align-items:center}
.pill{display:inline-block;padding:7px 14px;border-radius:999px;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);font-size:13px;font-weight:600;margin-bottom:22px}
.hero h1{font-size:clamp(32px,5vw,56px);line-height:1.13;font-weight:800;letter-spacing:-1px;margin-bottom:20px}
html[lang^=bn] .hero h1{letter-spacing:0;line-height:1.32}
.hero .sub{font-size:18px;opacity:.88;max-width:580px;margin-bottom:32px}
.cta{display:flex;gap:12px;flex-wrap:wrap}
.hero-card{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.16);border-radius:24px;padding:20px}
.hero-card img{border-radius:16px}
.hc-list{display:grid;gap:10px}
.hc-item{display:flex;align-items:center;gap:12px;background:rgba(255,255,255,.08);border-radius:14px;padding:12px 14px;font-weight:600;transition:.2s}.hc-item:hover{background:rgba(255,255,255,.15)}
.hc-item .i{font-size:22px;width:42px;height:42px;display:grid;place-items:center;background:rgba(255,255,255,.12);border-radius:12px;flex:none}
.hc-item small{display:block;opacity:.72;font-weight:500;font-size:12.5px}
@media(max-width:900px){.hero .wrap{grid-template-columns:1fr}.hero{padding:56px 0 90px}}
.phero{background:linear-gradient(160deg,var(--p),color-mix(in srgb,var(--p) 80%,#000));color:#fff;padding:46px 0 54px}
.phero h1{font-size:clamp(28px,4vw,44px);line-height:1.25;font-weight:800;margin:8px 0 10px}
.phero p{opacity:.88;font-size:17.5px;max-width:760px}
.phero .meta{opacity:.8;font-size:14.5px;margin-top:10px}
.crumbs{font-size:14px;opacity:.85}.crumbs ol{list-style:none;display:flex;flex-wrap:wrap;gap:6px}.crumbs li+li:before{content:"›";margin-right:6px;opacity:.7}.crumbs a:hover{text-decoration:underline}
.stats{margin-top:-56px;position:relative;z-index:2}
.stats .grid{background:#fff;border-radius:22px;box-shadow:0 20px 50px -20px rgba(15,23,42,.25);display:grid;grid-template-columns:repeat(4,1fr);padding:26px 10px}
.stat{text-align:center;padding:6px 12px;border-right:1px solid var(--line)}.stat:last-child{border:0}
.stat b{display:block;font-size:30px;color:var(--p);font-weight:800}.stat span{color:var(--mut);font-size:14px}
@media(max-width:700px){.stats .grid{grid-template-columns:repeat(2,1fr);row-gap:18px}.stat:nth-child(2){border:0}}
section.s{padding:84px 0}section.alt{background:var(--bg)}
.sh{text-align:center;max-width:720px;margin:0 auto 44px}
.sh .k{color:var(--a);font-weight:700;font-size:14px;letter-spacing:1.4px;text-transform:uppercase}
.sh h2{font-size:clamp(27px,3.5vw,40px);font-weight:800;color:var(--p);margin:8px 0 10px;line-height:1.25}
.sh p{color:var(--mut);font-size:17px}
.tabs{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-bottom:34px}
.tab{padding:10px 18px;border-radius:999px;background:#fff;border:1.5px solid var(--line);font-weight:700;font-size:14.5px;color:#334155}.tab.on,.tab[aria-current]{background:var(--p);border-color:var(--p);color:#fff}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
@media(max-width:980px){.grid3{grid-template-columns:repeat(2,1fr)}}@media(max-width:640px){.grid3{grid-template-columns:1fr}}
.card{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:26px;transition:.25s;display:flex;flex-direction:column;position:relative}
.card:hover{transform:translateY(-4px);box-shadow:0 24px 50px -24px rgba(15,23,42,.3);border-color:color-mix(in srgb,var(--a) 40%,var(--line))}
.card .ic{width:56px;height:56px;border-radius:16px;display:grid;place-items:center;font-size:28px;background:color-mix(in srgb,var(--a) 12%,#fff);margin-bottom:18px}
.card .thumb{margin:-26px -26px 18px;border-radius:var(--r) var(--r) 0 0;aspect-ratio:16/9;object-fit:cover;width:calc(100% + 52px);max-width:none}
.card h3{font-size:20px;color:var(--p);margin-bottom:6px;line-height:1.35}
.card h3 a:after{content:"";position:absolute;inset:0;border-radius:var(--r)}
.card p{color:var(--mut);font-size:15px}
.card ul{list-style:none;margin:16px 0;display:grid;gap:7px}.card li{font-size:14.5px;display:flex;gap:8px;color:#334155}.card li:before{content:"✓";color:var(--a);font-weight:800}
.card .foot{margin-top:auto;padding-top:16px;border-top:1px dashed var(--line);display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
.price{font-weight:700;color:var(--p);font-size:14.5px}
.badge{position:absolute;top:18px;right:18px;background:color-mix(in srgb,var(--a) 15%,#fff);color:color-mix(in srgb,var(--a) 65%,#000);font-size:12px;font-weight:700;padding:5px 10px;border-radius:999px;z-index:1}.badge.f{background:var(--p);color:#fff}
.lnk{color:var(--a);font-weight:700;font-size:14.5px}
.hl{display:flex;gap:16px;align-items:flex-start;background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:24px}
.hl .ic{flex:none;width:52px;height:52px;border-radius:14px;display:grid;place-items:center;font-size:24px;background:color-mix(in srgb,var(--p) 8%,#fff)}
.hl h3{font-size:18px;color:var(--p);margin-bottom:4px}.hl p{color:var(--mut);font-size:15px}
.steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:18px;counter-reset:st;list-style:none}
.step{background:#fff;border-radius:var(--r);padding:26px 22px;border:1px solid var(--line);counter-increment:st}
.step:before{content:counter(st);width:40px;height:40px;border-radius:12px;background:var(--a);color:#fff;font-weight:800;display:grid;place-items:center;margin-bottom:14px}
html[lang^=bn] .step:before{content:counter(st,bengali)}
.step h3{font-size:17px;color:var(--p);margin-bottom:4px}.step p{font-size:14.5px;color:var(--mut)}
.about{display:grid;grid-template-columns:1fr 1fr;gap:50px;align-items:center}
.about .txt p{color:#334155;font-size:17px;white-space:pre-line}
.about .box{background:linear-gradient(150deg,var(--p),color-mix(in srgb,var(--p) 65%,var(--a)));border-radius:24px;padding:34px;color:#fff;display:grid;gap:14px}
.about .box a{display:flex;gap:12px;align-items:center;font-weight:600}.about .box a:hover{text-decoration:underline}.about .box span{font-size:22px}
@media(max-width:860px){.about{grid-template-columns:1fr}}
.pf,.post{border-radius:var(--r);overflow:hidden;background:#fff;border:1px solid var(--line);display:flex;flex-direction:column;position:relative;transition:.25s}
.post:hover{box-shadow:0 24px 50px -24px rgba(15,23,42,.3);transform:translateY(-3px)}
.pf img,.post img{aspect-ratio:16/9;object-fit:cover;width:100%}
.post .ph{aspect-ratio:16/9;background:linear-gradient(150deg,var(--p),color-mix(in srgb,var(--p) 55%,var(--a)));display:grid;place-items:center;color:#fff;font-size:42px}
.pf div,.post .bd{padding:20px;display:flex;flex-direction:column;gap:6px;flex:1}
.pf h3,.post h3{color:var(--p);font-size:18px;line-height:1.4}.post h3 a:after{content:"";position:absolute;inset:0}
.pf p,.post p{color:var(--mut);font-size:14.5px}.post small{color:var(--mut);font-size:13px}
.tm{background:#fff;border:1px solid var(--line);border-radius:var(--r);padding:26px}
.tm .st{color:#f59e0b;letter-spacing:2px;margin-bottom:10px}.tm p{color:#334155;margin-bottom:18px}
.tm .who{display:flex;gap:12px;align-items:center}.tm .who img,.tm .who .av{width:44px;height:44px;border-radius:50%;object-fit:cover;background:var(--bg);display:grid;place-items:center;font-weight:800;color:var(--p)}
.tm .who b{display:block;color:var(--p)}.tm .who small{color:var(--mut)}
.faq{max-width:840px;margin:0 auto;display:grid;gap:12px}
.faq details{background:#fff;border:1px solid var(--line);border-radius:14px;padding:18px 22px}
.faq summary{font-weight:700;color:var(--p);cursor:pointer;list-style:none;display:flex;justify-content:space-between;gap:12px}
.faq summary::-webkit-details-marker{display:none}.faq summary:after{content:"+";font-size:22px;line-height:1;color:var(--a)}.faq details[open] summary:after{content:"−"}
.faq details p{margin-top:10px;color:var(--mut);white-space:pre-line}
.contact{display:grid;grid-template-columns:.9fr 1.1fr;gap:30px}
.cinfo{background:var(--p);color:#fff;border-radius:24px;padding:34px;display:grid;gap:20px;align-content:start}
.cinfo h2,.cinfo h3{font-size:23px}
.cinfo .row{display:flex;gap:14px;align-items:flex-start}.cinfo .row span{width:44px;height:44px;flex:none;border-radius:12px;background:rgba(255,255,255,.1);display:grid;place-items:center;font-size:20px}
.cinfo .row small{display:block;opacity:.72;font-size:13px}.cinfo .row a,.cinfo .row b{font-weight:700;word-break:break-word}
form.f{background:#fff;border:1px solid var(--line);border-radius:24px;padding:30px;display:grid;grid-template-columns:1fr 1fr;gap:16px;position:relative}
form.f .full{grid-column:1/-1}
form.f label{font-size:14px;font-weight:600;color:#334155;display:grid;gap:6px}
form.f input,form.f select,form.f textarea{font:inherit;padding:12px 14px;border:1.5px solid var(--line);border-radius:12px;background:#fbfcfe;width:100%;color:var(--ink)}
form.f input:focus,form.f select:focus,form.f textarea:focus{outline:0;border-color:var(--a);background:#fff}
form.f textarea{min-height:110px;resize:vertical}
.hp{position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden}
.msg{padding:12px 14px;border-radius:12px;font-weight:600;font-size:14.5px}.msg.ok{background:#e7f8f3;color:#0f766e}.msg.err{background:#fdecec;color:#b42318}
@media(max-width:860px){.contact{grid-template-columns:1fr}form.f{grid-template-columns:1fr;padding:22px}}
.map{margin-top:28px;border-radius:20px;overflow:hidden;border:1px solid var(--line)}.map iframe{width:100%;height:340px;border:0;display:block}
.detail{display:grid;grid-template-columns:1fr 400px;gap:40px;align-items:start;padding:50px 0 80px}
.detail aside{position:sticky;top:90px}
@media(max-width:980px){.detail{grid-template-columns:1fr}.detail aside{position:static}}
.prose{color:#1e293b;font-size:17px}
.prose h2{font-size:26px;color:var(--p);margin:34px 0 12px;line-height:1.3}.prose h3{font-size:21px;color:var(--p);margin:26px 0 10px}.prose h4{font-size:18px;margin:20px 0 8px}
.prose p{margin:0 0 16px}.prose ul,.prose ol{margin:0 0 18px 22px;display:grid;gap:6px}
.prose a:not(.btn){color:var(--a);font-weight:600;text-decoration:underline;text-underline-offset:3px}
.prose img{border-radius:14px;margin:20px 0}.prose blockquote{border-left:4px solid var(--a);padding:6px 18px;margin:18px 0;color:var(--mut);background:var(--bg);border-radius:0 12px 12px 0}
.prose code{background:var(--bg);padding:2px 6px;border-radius:6px;font-size:.92em}
.feats{display:grid;grid-template-columns:1fr 1fr;gap:10px;list-style:none;margin:0 0 10px!important}
.feats li{background:var(--bg);border-radius:12px;padding:11px 14px;font-size:15.5px;display:flex;gap:8px}.feats li:before{content:"✓";color:var(--a);font-weight:800}
@media(max-width:600px){.feats{grid-template-columns:1fr}}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}.gal img{border-radius:12px;aspect-ratio:16/10;object-fit:cover;width:100%;margin:0}
.sideform h2{font-size:21px;color:var(--p);margin-bottom:4px}.sideform p{color:var(--mut);margin-bottom:14px;font-size:15px}
.sideform form.f{grid-template-columns:1fr;padding:22px}
.pricebox{background:var(--bg);border-radius:16px;padding:18px 20px;margin:26px 0;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.cover{border-radius:20px;margin:-30px 0 30px;box-shadow:0 20px 50px -25px rgba(15,23,42,.45);width:100%}
.pager{display:flex;gap:12px;justify-content:center;margin-top:40px}
.nf{text-align:center;padding:110px 20px}.nf b{font-size:90px;color:var(--a);display:block;line-height:1}.nf h1{color:var(--p);font-size:32px;margin:10px 0}.nf p{color:var(--mut);margin-bottom:26px}
footer{background:color-mix(in srgb,var(--p) 90%,#000);color:#cbd5e1;padding:60px 0 26px;font-size:15px}
.fgrid{display:grid;grid-template-columns:1.4fr 1fr 1fr 1fr;gap:30px}
footer h2{color:#fff;margin-bottom:14px;font-size:16px}footer ul{list-style:none;display:grid;gap:8px}footer a:hover{color:#fff;text-decoration:underline}
footer .brand{margin-bottom:14px}
.soc{display:flex;gap:10px;margin-top:14px}.soc a{width:38px;height:38px;border-radius:10px;background:rgba(255,255,255,.08);display:grid;place-items:center;font-weight:800;font-size:14px}
.copy{border-top:1px solid rgba(255,255,255,.1);margin-top:40px;padding-top:20px;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:14px;opacity:.85}
@media(max-width:860px){.fgrid{grid-template-columns:1fr 1fr}}
.wa{position:fixed;right:20px;bottom:20px;z-index:60;width:58px;height:58px;border-radius:50%;background:#25D366;display:grid;place-items:center;box-shadow:0 10px 30px -8px rgba(0,0,0,.4)}.wa svg{width:30px;height:30px;fill:#fff}
.reveal{opacity:0;transform:translateY(16px);transition:opacity .6s ease,transform .6s ease}.reveal.in{opacity:1;transform:none}
.no-js .reveal{opacity:1;transform:none}
@media(prefers-reduced-motion:reduce){.reveal{opacity:1;transform:none;transition:none}html{scroll-behavior:auto}}
`.replace(/\n+/g, '\n');
}

/* ---------- Layout ---------- */
const WA_SVG = '<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M16 3C9 3 3.3 8.6 3.3 15.6c0 2.4.7 4.7 1.9 6.7L3 29l6.9-2.2c1.9 1.1 4 1.6 6.2 1.6 7 0 12.7-5.7 12.7-12.7S23 3 16 3zm0 23.2c-2 0-3.9-.6-5.6-1.6l-.4-.2-4.1 1.3 1.3-4-.3-.4c-1.1-1.7-1.7-3.7-1.7-5.7C5.2 9.7 10 4.9 16 4.9s10.8 4.8 10.8 10.8S21.9 26.2 16 26.2zm5.9-8c-.3-.2-1.9-.9-2.2-1-.3-.1-.5-.2-.7.2-.2.3-.8 1-1 1.2-.2.2-.4.2-.7.1-.3-.2-1.4-.5-2.6-1.6-1-.9-1.6-1.9-1.8-2.2-.2-.3 0-.5.1-.7l.5-.6c.2-.2.2-.3.3-.6.1-.2 0-.4 0-.6l-1-2.4c-.3-.6-.5-.5-.7-.5h-.6c-.2 0-.6.1-.9.4-.3.3-1.2 1.1-1.2 2.8s1.2 3.2 1.4 3.5c.2.2 2.4 3.6 5.7 5 .8.3 1.4.5 1.9.7.8.3 1.5.2 2.1.1.6-.1 1.9-.8 2.2-1.5.3-.7.3-1.4.2-1.5-.1-.2-.3-.3-.6-.4z"/></svg>';
const telHref = (p) => 'tel:' + String(p || '').replace(/[^+0-9]/g, '');
const waHref = (text) => 'https://wa.me/' + String(db.settings.whatsapp || '').replace(/\D/g, '') + (text ? '?text=' + encodeURIComponent(text) : '');
const visible = (arr) => (arr || []).filter((x) => x.visible !== false).sort((a, b) => (a.order || 0) - (b.order || 0));
const publishedPosts = () => db.posts.filter((p) => p.published !== false && (p.publishedAt || '') <= now().slice(0, 10))
  .sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)) || (b.createdAt || '').localeCompare(a.createdAt || ''));
const sec = (k) => !db.settings.sections || db.settings.sections[k] !== false;
const usedCats = () => [...db.categories].sort((a, b) => (a.order || 0) - (b.order || 0)).filter((c) => visible(db.solutions).some((s) => s.category === c.id));

function layout(c, o) {
  const S = db.settings;
  const lang = c.lang;
  const title = o.title || c.t(S.seoTitle) || S.siteName;
  const desc = clip(o.desc || c.t(S.seoDescription), 165);
  const pathNow = c.L(o.path);
  const canonical = abs(pathNow) + (o.query || '');
  const alts = o.noAlt ? '' : LANGS.map((l) => `<link rel="alternate" hreflang="${l}" href="${esc(abs(L(l, o.path)) + (o.query || ''))}">`).join('') +
    `<link rel="alternate" hreflang="x-default" href="${esc(abs(L(DEF(), o.path)) + (o.query || ''))}">`;
  const ogImg = absAsset(safeUrl(o.image) || safeUrl(S.ogImage) || '/assets/og-image.jpg');
  const ogD = dims(safeUrl(o.image) || safeUrl(S.ogImage) || '/assets/og-image.jpg');
  const ld = (o.jsonld || []).map((x) => `<script type="application/ld+json">${JSON.stringify(x).replace(/</g, '\\u003c')}</script>`).join('\n');
  const nav = [
    sec('solutions') && ['/solutions', c.u('nav_solutions')],
    publishedPosts().length && sec('blog') && ['/blog', c.u('nav_blog')],
    sec('about') && ['/#about', c.u('nav_about')],
    sec('faq') && visible(db.faqs).length && ['/#faq', c.u('nav_faq')],
    ['/contact', c.u('nav_contact')],
  ].filter(Boolean);
  const active = (p) => (o.path === p || (p !== '/' && !p.includes('#') && o.path.startsWith(p + '/')) ? ' aria-current="page"' : '');
  const href = (p) => (p.startsWith('/#') ? (c.L('/') === '/' ? '/' : c.L('/')) + p.slice(1) : c.L(p));
  const social = [['f', S.facebook, 'Facebook'], ['▶', S.youtube, 'YouTube'], ['in', S.linkedin, 'LinkedIn'], ['ig', S.instagram, 'Instagram']]
    .filter((x) => safeUrl(x[1])).map(([l, h, n]) => `<a href="${esc(safeUrl(h))}" target="_blank" rel="noopener me" aria-label="${n}">${l}</a>`).join('');
  const footPages = visible(db.pages).filter((p) => p.inFooter);
  const bx = { lang, page: o.page || { type: 'page' }, ga: validGA(S.ga4Id), px: validPixel(S.metaPixelId), sa: S.selfAnalytics !== false,
    ui: { ok: c.u('ok'), err: c.u('err'), many: c.u('err_many'), net: c.u('err_net'), send: c.u('f_send'), sending: c.u('f_sending') } };
  return `<!DOCTYPE html>
<html lang="${lang === 'bn' ? 'bn-BD' : 'en'}" class="no-js">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta name="robots" content="${o.noindex ? 'noindex, follow' : 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1'}">
${o.noindex ? '' : `<link rel="canonical" href="${esc(canonical)}">`}
${o.prev ? `<link rel="prev" href="${esc(o.prev)}">` : ''}${o.next ? `<link rel="next" href="${esc(o.next)}">` : ''}
${o.noindex ? '' : alts}
<meta property="og:type" content="${o.ogType || 'website'}">
<meta property="og:site_name" content="${esc(S.siteName)}">
<meta property="og:title" content="${esc(o.ogTitle || title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(canonical)}">
<meta property="og:image" content="${esc(ogImg)}">${ogD ? `<meta property="og:image:width" content="${ogD.w}"><meta property="og:image:height" content="${ogD.h}">` : ''}
<meta property="og:image:alt" content="${esc(o.ogTitle || title)}">
<meta property="og:locale" content="${lang === 'bn' ? 'bn_BD' : 'en_US'}"><meta property="og:locale:alternate" content="${lang === 'bn' ? 'en_US' : 'bn_BD'}">
${o.article ? `<meta property="article:published_time" content="${esc(o.article.published)}"><meta property="article:modified_time" content="${esc(o.article.modified)}">` : ''}
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(o.ogTitle || title)}"><meta name="twitter:description" content="${esc(desc)}"><meta name="twitter:image" content="${esc(ogImg)}">
<meta name="theme-color" content="${esc(S.primaryColor || '#124874')}">
<meta name="format-detection" content="telephone=no">
${S.gscVerification ? `<meta name="google-site-verification" content="${esc(S.gscVerification)}">` : ''}
${S.bingVerification ? `<meta name="msvalidate.01" content="${esc(S.bingVerification)}">` : ''}
${S.fbDomainVerification ? `<meta name="facebook-domain-verification" content="${esc(S.fbDomainVerification)}">` : ''}
<link rel="icon" href="${esc(safeUrl(S.favicon) || '/assets/favicon.png')}" type="image/png">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="alternate" type="application/rss+xml" title="${esc(S.siteName)} — ${esc(c.u('nav_blog'))}" href="${c.L('/rss.xml')}">
<link rel="preload" href="/assets/fonts/${lang === 'bn' ? 'hind-siliguri-bengali-600-normal' : 'plus-jakarta-sans-latin-800-normal'}.woff2" as="font" type="font/woff2" crossorigin>
<style>${css()}</style>
<script>document.documentElement.classList.remove('no-js')</script>
${ld}
${trackingHead()}${S.headScripts || ''}
</head>
<body>
${trackingBody()}
<a class="skip" href="#main">${c.u('skip')}</a>
${c.t(S.announcement) ? `<div class="ann">${esc(c.t(S.announcement))}</div>` : ''}
<header class="top"><div class="wrap nav">
  <a href="${c.L('/')}" class="brand" aria-label="${esc(S.siteName)} — ${c.u('home')}">${img(LOGO(), S.siteName, { eager: true })}</a>
  <nav class="links" id="links" aria-label="Main">${nav.map(([p, n]) => `<a href="${esc(href(p))}"${active(p)}>${esc(n)}</a>`).join('')}</nav>
  <a class="lsw" href="${esc(o.noAlt ? L(OTHER(lang), '/') : L(OTHER(lang), o.path) + (o.query || ''))}" hreflang="${OTHER(lang)}" lang="${OTHER(lang)}" data-lang="${OTHER(lang)}">${c.u('other_lang')}</a>
  <a href="${esc(c.L('/contact'))}" class="btn btn-a">${c.u('get_demo')}</a>
  <button class="burger" id="burger" aria-label="${c.u('menu')}" aria-controls="links" aria-expanded="false">☰</button>
</div></header>
<main id="main">
${o.body}
</main>
<footer><div class="wrap">
  <div class="fgrid">
    <div><a class="brand" href="${c.L('/')}">${img(LOGO_DARK(), S.siteName, { style: 'height:46px;width:auto' })}</a><p>${esc(c.t(S.footerText))}</p><div class="soc">${social}</div></div>
    <div><h2>${c.u('sol_f')}</h2><ul>${usedCats().map((x) => `<li><a href="${esc(c.L('/category/' + x.id))}">${esc(c.t(x.name))}</a></li>`).join('')}<li><a href="${c.L('/solutions')}">${c.u('all_solutions')}</a></li></ul></div>
    <div><h2>${c.u('quick')}</h2><ul>${publishedPosts().length ? `<li><a href="${c.L('/blog')}">${c.u('nav_blog')}</a></li>` : ''}${footPages.map((p) => `<li><a href="${esc(c.L('/' + p.slug))}">${esc(c.t(p.title))}</a></li>`).join('')}<li><a href="${c.L('/contact')}">${c.u('nav_contact')}</a></li></ul></div>
    <div><h2>${c.u('nav_contact')}</h2><address style="font-style:normal"><ul>${S.phone ? `<li><a href="${telHref(S.phone)}">${esc(c.num(S.phone))}</a></li>` : ''}${S.email ? `<li><a href="mailto:${esc(S.email)}">${esc(S.email)}</a></li>` : ''}${c.t(S.address) ? `<li>${esc(c.t(S.address))}</li>` : ''}${c.t(S.officeHours) ? `<li>${esc(c.t(S.officeHours))}</li>` : ''}</ul></address></div>
  </div>
  <div class="copy"><span>© ${c.num(new Date().getFullYear())} ${esc(S.siteName)}. ${c.u('rights')}</span><span>${esc(c.t(S.tagline))}</span></div>
</div></footer>
${S.whatsapp ? `<a class="wa" href="${esc(waHref())}" target="_blank" rel="noopener" aria-label="WhatsApp">${WA_SVG}</a>` : ''}
<script>window.BX=${JSON.stringify(bx).replace(/</g, '\\u003c')};</script>
<script src="/assets/site.js?v=${CONFIG.ASSET_VERSION}" defer></script>
${S.bodyScripts || ''}
</body>
</html>`;
}

/* ---------- Components ---------- */
function crumbs(c, items) {
  return `<nav class="crumbs" aria-label="${c.u('breadcrumb')}"><ol>${items.map((x, i) => i === items.length - 1
    ? `<li aria-current="page">${esc(x.name)}</li>` : `<li><a href="${esc(x.url)}">${esc(x.name)}</a></li>`).join('')}</ol></nav>`;
}
const catName = (c, id) => c.t((db.categories.find((x) => x.id === id) || {}).name);
function solCard(c, s, hTag = 'h3') {
  const href = c.L('/solutions/' + s.slug);
  const feats = (s.features || []).slice(0, 4).map((f) => `<li>${esc(c.t(f))}</li>`).join('');
  const badge = c.t(s.badge) ? `<span class="badge">${esc(c.t(s.badge))}</span>` : (s.featured ? `<span class="badge f">★ ${c.u('featured')}</span>` : '');
  const top = s.image ? img(s.image, c.t(s.name), { cls: 'thumb' }) : `<div class="ic" aria-hidden="true">${esc(s.icon || '📦')}</div>`;
  return `<article class="card reveal" data-cat="${esc(s.category)}">${badge}${top}
    <${hTag}><a href="${esc(href)}">${esc(c.t(s.name))}</a></${hTag}><p>${esc(c.t(s.short))}</p>${feats ? `<ul>${feats}</ul>` : ''}
    <div class="foot"><span class="price">${esc(c.t(s.price))}</span><span class="lnk" aria-hidden="true">${c.u('details')} →</span></div></article>`;
}
function postCard(c, p, hTag = 'h3') {
  const href = c.L('/blog/' + p.slug);
  return `<article class="post reveal">${p.cover ? img(p.cover, c.t(p.title)) : '<div class="ph" aria-hidden="true">📝</div>'}
    <div class="bd"><small><time datetime="${esc(p.publishedAt)}">${esc(c.date(p.publishedAt))}</time> · ${c.num(readMins(c.t(p.content)))} ${c.u('min_read')}</small>
    <${hTag}><a href="${esc(href)}">${esc(c.t(p.title))}</a></${hTag}><p>${esc(clip(c.t(p.excerpt) || stripMd(c.t(p.content)), 150))}</p></div></article>`;
}
function leadForm(c, type, solution, idp = 'f') {
  const S = db.settings;
  return `<form class="f" data-type="${type}" method="post" action="/lead" novalidate>
    <div class="hp" aria-hidden="true"><label>Website<input name="website" tabindex="-1" autocomplete="off"></label></div>
    <input type="hidden" name="type" value="${type}"><input type="hidden" name="lang" value="${c.lang}">
    <label for="${idp}-name">${c.u('f_name')} *<input id="${idp}-name" name="name" required maxlength="120" autocomplete="name"></label>
    <label for="${idp}-phone">${c.u('f_phone')} *<input id="${idp}-phone" name="phone" required maxlength="20" inputmode="tel" autocomplete="tel" placeholder="01XXXXXXXXX"></label>
    <label for="${idp}-email">${c.u('f_email')}<input id="${idp}-email" name="email" type="email" maxlength="160" autocomplete="email"></label>
    <label for="${idp}-company">${c.u('f_company')}<input id="${idp}-company" name="company" maxlength="160" autocomplete="organization"></label>
    <label class="full" for="${idp}-sol">${c.u('f_solution')}<select id="${idp}-sol" name="solution"><option value="">${c.u('f_any')}</option>${visible(db.solutions).map((s) => `<option${c.t(s.name) === solution ? ' selected' : ''}>${esc(c.t(s.name))}</option>`).join('')}</select></label>
    <label class="full" for="${idp}-msg">${c.u('f_msg')}<textarea id="${idp}-msg" name="message" maxlength="3000"></textarea></label>
    <div class="full fmsg" role="status" aria-live="polite"></div>
    <button class="btn btn-a full" type="submit">${c.u('f_send')}</button>
  </form>`;
}
function contactInfo(c, hTag = 'h3') {
  const S = db.settings;
  const rows = [
    S.phone && ['📞', c.u('phone'), `<a href="${telHref(S.phone)}">${esc(c.num(S.phone))}</a>`],
    S.whatsapp && ['💬', c.u('whatsapp'), `<a href="${esc(waHref())}" target="_blank" rel="noopener">${esc(c.num('+' + String(S.whatsapp).replace(/\D/g, '')))}</a>`],
    S.email && ['✉️', c.u('email'), `<a href="mailto:${esc(S.email)}">${esc(S.email)}</a>`],
    c.t(S.address) && ['📍', c.u('address'), `<b>${esc(c.t(S.address))}</b>`],
    c.t(S.officeHours) && ['🕘', c.u('hours'), `<b>${esc(c.t(S.officeHours))}</b>`],
  ].filter(Boolean).map(([i, l, v]) => `<div class="row"><span aria-hidden="true">${i}</span><div><small>${l}</small>${v}</div></div>`).join('');
  return `<div class="cinfo"><${hTag}>${esc(S.siteName)}</${hTag}>${rows}${S.phone ? `<a class="btn btn-a" style="justify-self:start" href="${telHref(S.phone)}">📞 ${c.u('call')}</a>` : ''}</div>`;
}
function mapEmbed(c) {
  const u = String(db.settings.mapEmbedUrl || '').trim();
  if (!/^https:\/\/(www\.)?google\.com\/maps\/embed\?/.test(u)) return '';
  return `<div class="map"><iframe src="${esc(u)}" title="${c.u('map')}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" allowfullscreen></iframe></div>`;
}
const sh = (k, h, p, hTag = 'h2') => `<div class="sh"><div class="k">${esc(k)}</div><${hTag}>${esc(h)}</${hTag}>${p ? `<p>${esc(p)}</p>` : ''}</div>`;

/* ============================== PAGES ============================== */
function pageHome(c) {
  const S = db.settings;
  const sols = visible(db.solutions), faqs = visible(db.faqs), posts = publishedPosts().slice(0, 3);
  const heroItems = (sols.filter((s) => s.featured).length ? sols.filter((s) => s.featured) : sols).slice(0, 4);
  const body = `
<section class="hero"><div class="wrap">
  <div>
    ${c.t(S.heroBadge) ? `<span class="pill">${esc(c.t(S.heroBadge))}</span>` : ''}
    <h1>${esc(c.t(S.heroTitle))}</h1>
    <p class="sub">${esc(c.t(S.heroSubtitle))}</p>
    <div class="cta"><a href="${c.L('/solutions')}" class="btn btn-a">${esc(c.t(S.heroCta))} →</a><a href="${c.L('/contact')}" class="btn btn-o">${esc(c.t(S.heroCta2))}</a></div>
  </div>
  <div class="hero-card">${S.heroImage ? img(S.heroImage, c.t(S.heroTitle), { eager: true })
    : `<div class="hc-list">${heroItems.map((s) => `<a class="hc-item" href="${esc(c.L('/solutions/' + s.slug))}"><span class="i" aria-hidden="true">${esc(s.icon)}</span><span>${esc(c.t(s.name))}<small>${esc(catName(c, s.category))}</small></span></a>`).join('')}</div>`}
  </div>
</div></section>
${(S.stats || []).length ? `<div class="stats"><div class="wrap"><div class="grid">${S.stats.map((x) => `<div class="stat"><b>${esc(c.t(x.value))}</b><span>${esc(c.t(x.label))}</span></div>`).join('')}</div></div></div>` : ''}
${sec('solutions') ? `<section class="s" id="solutions"><div class="wrap">${sh(c.u('sol_k'), c.u('sol_h'), c.u('sol_p'))}
  <div class="tabs" role="tablist"><a class="tab on" data-cat="all" href="${c.L('/solutions')}">${c.u('all')}</a>${usedCats().map((x) => `<a class="tab" data-cat="${esc(x.id)}" href="${esc(c.L('/category/' + x.id))}">${esc(x.icon || '')} ${esc(c.t(x.name))}</a>`).join('')}</div>
  <div class="grid3" id="solgrid">${sols.map((s) => solCard(c, s)).join('')}</div></div></section>` : ''}
${sec('highlights') && visible(db.highlights).length ? `<section class="s alt" id="why"><div class="wrap">${sh(c.u('why_k'), c.u('why_h'), c.u('why_p'))}
  <div class="grid3">${visible(db.highlights).map((h) => `<div class="hl reveal"><div class="ic" aria-hidden="true">${esc(h.icon)}</div><div><h3>${esc(c.t(h.title))}</h3><p>${esc(c.t(h.text))}</p></div></div>`).join('')}</div></div></section>` : ''}
${sec('steps') && visible(db.steps).length ? `<section class="s" id="process"><div class="wrap">${sh(c.u('steps_k'), c.u('steps_h'), c.u('steps_p'))}
  <ol class="steps">${visible(db.steps).map((s) => `<li class="step reveal"><h3>${esc(c.t(s.title))}</h3><p>${esc(c.t(s.text))}</p></li>`).join('')}</ol></div></section>` : ''}
${sec('about') && c.t(S.about) ? `<section class="s alt" id="about"><div class="wrap about">
  <div class="txt reveal"><div class="sh" style="text-align:left;margin:0 0 18px"><div class="k">${c.u('nav_about')}</div><h2>${esc(c.t(S.aboutTitle))}</h2></div><p>${esc(c.t(S.about))}</p></div>
  <div class="box reveal">${usedCats().map((x) => `<a href="${esc(c.L('/category/' + x.id))}"><span aria-hidden="true">${esc(x.icon)}</span>${esc(c.t(x.name))} — ${c.num(sols.filter((s) => s.category === x.id).length)} ${c.u('solutions_in')}</a>`).join('')}
    <a href="${c.L('/contact')}" class="btn btn-a" style="justify-self:start;margin-top:8px">${c.u('get_demo')}</a></div></div></section>` : ''}
${sec('portfolio') && visible(db.portfolio).length ? `<section class="s" id="portfolio"><div class="wrap">${sh(c.u('pf_k'), c.u('pf_h'), c.u('pf_p'))}
  <div class="grid3">${visible(db.portfolio).map((p) => `<div class="pf reveal">${p.image ? img(p.image, c.t(p.title)) : ''}<div><h3>${safeUrl(p.url) ? `<a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(c.t(p.title))}</a>` : esc(c.t(p.title))}</h3><p>${esc(c.t(p.text))}</p></div></div>`).join('')}</div></div></section>` : ''}
${sec('testimonials') && visible(db.testimonials).length ? `<section class="s alt"><div class="wrap">${sh(c.u('tm_k'), c.u('tm_h'))}
  <div class="grid3">${visible(db.testimonials).map((m) => `<figure class="tm reveal"><div class="st" aria-label="${m.rating || 5}/5">${'★'.repeat(m.rating || 5)}</div><blockquote><p>“${esc(c.t(m.text))}”</p></blockquote><figcaption class="who">${m.photo ? img(m.photo, c.t(m.name)) : `<div class="av" aria-hidden="true">${esc((c.t(m.name) || '?')[0])}</div>`}<div><b>${esc(c.t(m.name))}</b><small>${esc(c.t(m.role))}</small></div></figcaption></figure>`).join('')}</div></div></section>` : ''}
${sec('blog') && posts.length ? `<section class="s" id="blog"><div class="wrap">${sh(c.u('blog_k'), c.u('latest'), c.u('blog_p'))}
  <div class="grid3">${posts.map((p) => postCard(c, p)).join('')}</div><div style="text-align:center;margin-top:30px"><a class="btn btn-l" href="${c.L('/blog')}">${c.u('view_all')} →</a></div></div></section>` : ''}
${sec('faq') && faqs.length ? `<section class="s alt" id="faq"><div class="wrap">${sh(c.u('faq_k'), c.u('faq_h'))}
  <div class="faq">${faqs.map((f, i) => `<details${i === 0 ? ' open' : ''}><summary>${esc(c.t(f.q))}</summary><p>${esc(c.t(f.a))}</p></details>`).join('')}</div></div></section>` : ''}
${sec('contact') ? `<section class="s" id="contact"><div class="wrap">${sh(c.u('ct_k'), c.u('ct_h'), c.u('ct_p'))}
  <div class="contact">${contactInfo(c)}${leadForm(c, 'contact', '', 'hc')}</div>${mapEmbed(c)}</div></section>` : ''}`;
  const ld = [orgLd(), localLd(c), websiteLd(c)];
  if (sec('faq') && faqs.length) ld.push(faqLd(c, faqs));
  return layout(c, { path: '/', body, jsonld: ld, page: { type: 'home' } });
}

function pageSolutions(c) {
  const sols = visible(db.solutions);
  const bc = [{ name: c.u('home'), url: c.L('/') }, { name: c.u('nav_solutions'), url: c.L('/solutions') }];
  const body = `<section class="phero"><div class="wrap">${crumbs(c, bc)}<h1>${c.u('sol_h')}</h1><p>${c.u('sol_p')}</p></div></section>
  ${usedCats().map((x, i) => `<section class="s${i % 2 ? ' alt' : ''}" id="${esc(x.id)}"><div class="wrap">
    <div class="sh"><div class="k">${esc(x.icon)} ${esc(c.t(x.name))}</div><h2><a href="${esc(c.L('/category/' + x.id))}">${esc(c.t(x.seoTitle) || c.t(x.name))}</a></h2>${c.t(x.description) ? `<p>${esc(c.t(x.description))}</p>` : ''}</div>
    <div class="grid3">${sols.filter((s) => s.category === x.id).map((s) => solCard(c, s)).join('')}</div></div></section>`).join('')}
  <section class="s alt"><div class="wrap">${sh(c.u('ct_k'), c.u('ct_h'), c.u('ct_p'))}<div class="contact">${contactInfo(c)}${leadForm(c, 'contact', '', 'sc')}</div></div></section>`;
  return layout(c, { path: '/solutions', title: `${c.u('nav_solutions')} — ${c.t(db.settings.seoTitle)}`, desc: c.u('sol_p') + ' ' + c.t(db.settings.seoDescription), body,
    jsonld: [breadcrumbLd(bc), itemListLd(c, sols)], page: { type: 'solutions' } });
}

function pageCategory(c, cat) {
  const sols = visible(db.solutions).filter((s) => s.category === cat.id);
  const bc = [{ name: c.u('home'), url: c.L('/') }, { name: c.u('nav_solutions'), url: c.L('/solutions') }, { name: c.t(cat.name), url: c.L('/category/' + cat.id) }];
  const others = usedCats().filter((x) => x.id !== cat.id);
  const body = `<section class="phero"><div class="wrap">${crumbs(c, bc)}<h1>${esc(c.t(cat.seoTitle) || c.t(cat.name))}</h1>${c.t(cat.description) ? `<p>${esc(c.t(cat.description))}</p>` : ''}</div></section>
  <section class="s"><div class="wrap">
    <div class="tabs"><a class="tab" href="${c.L('/solutions')}">${c.u('all')}</a>${usedCats().map((x) => `<a class="tab"${x.id === cat.id ? ' aria-current="page"' : ''} href="${esc(c.L('/category/' + x.id))}">${esc(x.icon)} ${esc(c.t(x.name))}</a>`).join('')}</div>
    <div class="grid3">${sols.map((s) => solCard(c, s, 'h2')).join('')}</div></div></section>
  <section class="s alt"><div class="wrap">${sh(c.u('ct_k'), c.u('ct_h'), c.u('ct_p'))}<div class="contact">${contactInfo(c)}${leadForm(c, 'contact', '', 'cc')}</div></div></section>`;
  return layout(c, { path: '/category/' + cat.id, title: (c.t(cat.seoTitle) || c.t(cat.name)) + ' | ' + db.settings.siteName,
    desc: c.t(cat.seoDescription) || c.t(cat.description), body, jsonld: [breadcrumbLd(bc), itemListLd(c, sols)], page: { type: 'category', id: cat.id }, _others: others });
}

function pageSolution(c, s) {
  const S = db.settings;
  const cat = db.categories.find((x) => x.id === s.category);
  const bc = [{ name: c.u('home'), url: c.L('/') }, { name: c.u('nav_solutions'), url: c.L('/solutions') }];
  if (cat) bc.push({ name: c.t(cat.name), url: c.L('/category/' + cat.id) });
  bc.push({ name: c.t(s.name), url: c.L('/solutions/' + s.slug) });
  const related = visible(db.solutions).filter((x) => x.category === s.category && x.id !== s.id).slice(0, 3);
  const feats = (s.features || []).map((f) => `<li>${esc(c.t(f))}</li>`).join('');
  const gal = (s.gallery || []).filter(safeUrl).map((g, i) => `<a href="${esc(g)}" target="_blank" rel="noopener">${img(g, `${c.t(s.name)} — ${c.u('gallery')} ${c.num(i + 1)}`)}</a>`).join('');
  const body = `<section class="phero"><div class="wrap">${crumbs(c, bc)}
    <div style="display:flex;gap:18px;align-items:center;margin-top:14px"><span aria-hidden="true" style="font-size:34px;width:66px;height:66px;border-radius:18px;background:rgba(255,255,255,.12);display:grid;place-items:center;flex:none">${esc(s.icon || '📦')}</span>
    <div><small style="opacity:.8;font-weight:600">${esc(catName(c, s.category))}</small><h1 style="margin:2px 0 0">${esc(c.t(s.name))}</h1></div></div>
    <p style="margin-top:14px">${esc(c.t(s.short))}</p>
    <div class="cta" style="margin-top:22px"><a class="btn btn-a" href="#demo">${c.u('request_demo')}</a>${safeUrl(s.demoUrl) ? `<a class="btn btn-o" href="${esc(safeUrl(s.demoUrl))}" target="_blank" rel="noopener">${c.u('live_demo')} ↗</a>` : ''}${S.whatsapp ? `<a class="btn btn-o" href="${esc(waHref(c.t(s.name)))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ''}</div>
  </div></section>
  <div class="wrap detail">
    <article class="prose">
      ${s.image ? img(s.image, c.t(s.name), { eager: true, cls: 'cover' }) : ''}
      ${md(c.t(s.description), c)}
      ${feats ? `<h2>${c.u('features')}</h2><ul class="feats">${feats}</ul>` : ''}
      <div class="pricebox"><div><small style="color:var(--mut)">${c.u('price')}</small><div class="price" style="font-size:18px">${esc(c.t(s.price))}</div></div><a class="btn btn-a" href="#demo">${c.u('get_demo')}</a></div>
      ${gal ? `<h2>${c.u('gallery')}</h2><div class="gal">${gal}</div>` : ''}
    </article>
    <aside class="sideform" id="demo"><h2>${c.u('request_demo')}</h2><p>${c.u('interested_p')}</p>${leadForm(c, 'demo', c.t(s.name), 'sd')}</aside>
  </div>
  ${related.length ? `<section class="s alt"><div class="wrap">${sh(catName(c, s.category), c.u('related'))}<div class="grid3">${related.map((x) => solCard(c, x)).join('')}</div></div></section>` : ''}`;
  const sw = { '@context': 'https://schema.org', '@type': 'SoftwareApplication', name: c.t(s.name), description: clip(stripMd(c.t(s.description)) || c.t(s.short), 300),
    applicationCategory: 'BusinessApplication', operatingSystem: 'Web, Android', url: abs(c.L('/solutions/' + s.slug)), inLanguage: ['bn', 'en'],
    image: s.image ? absAsset(s.image) : undefined, featureList: (s.features || []).map((f) => c.t(f)).join(', ') || undefined,
    provider: { '@id': ORG_ID() }, publisher: { '@id': ORG_ID() } };
  if (Number(s.priceValue) > 0) sw.offers = { '@type': 'Offer', price: Number(s.priceValue), priceCurrency: 'BDT', availability: 'https://schema.org/InStock', url: abs(c.L('/solutions/' + s.slug)) };
  return layout(c, { path: '/solutions/' + s.slug, title: c.t(s.seoTitle) || `${c.t(s.name)} — ${catName(c, s.category)} | ${S.siteName}`,
    desc: c.t(s.seoDescription) || c.t(s.short) + ' ' + clip(stripMd(c.t(s.description)), 120), image: s.image || '', ogTitle: c.t(s.name),
    body, jsonld: [breadcrumbLd(bc), sw, orgLd()], page: { type: 'solution', id: s.slug, name: c.t(s.name), category: catName(c, s.category) } });
}

const PER_PAGE = 9;
function pageBlog(c, pg) {
  const all = publishedPosts();
  const pages = Math.max(1, Math.ceil(all.length / PER_PAGE));
  if (pg > pages) return null;
  const list = all.slice((pg - 1) * PER_PAGE, pg * PER_PAGE);
  const q = (n) => (n > 1 ? '?page=' + n : '');
  const bc = [{ name: c.u('home'), url: c.L('/') }, { name: c.u('nav_blog'), url: c.L('/blog') }];
  const body = `<section class="phero"><div class="wrap">${crumbs(c, bc)}<h1>${c.u('blog_h')}${pg > 1 ? ` — ${c.u('page')} ${c.num(pg)}` : ''}</h1><p>${c.u('blog_p')}</p></div></section>
  <section class="s"><div class="wrap"><div class="grid3">${list.map((p) => postCard(c, p, 'h2')).join('')}</div>
  ${pages > 1 ? `<nav class="pager" aria-label="${c.u('page')}">${pg > 1 ? `<a class="btn btn-l" rel="prev" href="${c.L('/blog') + q(pg - 1)}">${c.u('prev')}</a>` : ''}${pg < pages ? `<a class="btn btn-l" rel="next" href="${c.L('/blog') + q(pg + 1)}">${c.u('next')}</a>` : ''}</nav>` : ''}</div></section>`;
  return layout(c, { path: '/blog', query: q(pg), title: `${c.u('blog_h')}${pg > 1 ? ` — ${c.u('page')} ${c.num(pg)}` : ''} | ${db.settings.siteName}`, desc: c.u('blog_p'), body,
    prev: pg > 1 ? abs(c.L('/blog')) + q(pg - 1) : '', next: pg < pages ? abs(c.L('/blog')) + q(pg + 1) : '',
    jsonld: [breadcrumbLd(bc), { '@context': 'https://schema.org', '@type': 'Blog', name: `${db.settings.siteName} — ${c.u('nav_blog')}`, url: abs(c.L('/blog')), publisher: { '@id': ORG_ID() },
      blogPost: list.map((p) => ({ '@type': 'BlogPosting', headline: c.t(p.title), url: abs(c.L('/blog/' + p.slug)), datePublished: p.publishedAt })) }], page: { type: 'blog' } });
}

function pagePost(c, p) {
  const S = db.settings;
  const bc = [{ name: c.u('home'), url: c.L('/') }, { name: c.u('nav_blog'), url: c.L('/blog') }, { name: c.t(p.title), url: c.L('/blog/' + p.slug) }];
  const more = publishedPosts().filter((x) => x.id !== p.id).slice(0, 3);
  const modified = (p.updatedAt || p.createdAt || '').slice(0, 10) || p.publishedAt;
  const body = `<section class="phero"><div class="wrap" style="max-width:900px">${crumbs(c, bc)}<h1>${esc(c.t(p.title))}</h1>
    <div class="meta">${c.u('published')}: <time datetime="${esc(p.publishedAt)}">${esc(c.date(p.publishedAt))}</time> · ${c.num(readMins(c.t(p.content)))} ${c.u('min_read')}</div></div></section>
  <div class="wrap" style="max-width:900px;padding-top:${p.cover ? 0 : 40}px;padding-bottom:60px">
    ${p.cover ? img(p.cover, c.t(p.title), { eager: true, cls: 'cover' }) : ''}
    <article class="prose">${md(c.t(p.content), c)}</article>
    <div class="pricebox" style="margin-top:36px"><div><b style="color:var(--p);font-size:18px">${c.u('interested')}</b><div style="color:var(--mut)">${c.u('interested_p')}</div></div><a class="btn btn-a" href="${c.L('/contact')}">${c.u('get_demo')}</a></div>
  </div>
  ${more.length ? `<section class="s alt"><div class="wrap">${sh(c.u('blog_k'), c.u('more_posts'))}<div class="grid3">${more.map((x) => postCard(c, x)).join('')}</div></div></section>` : ''}`;
  const ld = { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: clip(c.t(p.title), 110), description: c.t(p.seoDescription) || c.t(p.excerpt),
    image: absAsset(p.cover || safeUrl(S.ogImage) || '/assets/og-image.jpg'), datePublished: p.publishedAt, dateModified: modified,
    inLanguage: c.lang === 'bn' ? 'bn-BD' : 'en', mainEntityOfPage: abs(c.L('/blog/' + p.slug)), url: abs(c.L('/blog/' + p.slug)),
    author: { '@type': 'Organization', name: S.siteName, url: CONFIG.SITE_URL + '/' }, publisher: { '@id': ORG_ID() },
    wordCount: String(c.t(p.content)).split(/\s+/).length };
  return layout(c, { path: '/blog/' + p.slug, title: c.t(p.seoTitle) || `${c.t(p.title)} | ${S.siteName}`, desc: c.t(p.seoDescription) || c.t(p.excerpt) || stripMd(c.t(p.content)),
    image: p.cover, ogType: 'article', ogTitle: c.t(p.title), article: { published: p.publishedAt, modified }, body, jsonld: [breadcrumbLd(bc), ld, orgLd()], page: { type: 'post', id: p.slug, name: c.t(p.title) } });
}

function pageCustom(c, p) {
  const bc = [{ name: c.u('home'), url: c.L('/') }, { name: c.t(p.title), url: c.L('/' + p.slug) }];
  const body = `<section class="phero"><div class="wrap">${crumbs(c, bc)}<h1>${esc(c.t(p.title))}</h1>${c.t(p.intro) ? `<p>${esc(c.t(p.intro))}</p>` : ''}
    <div class="cta" style="margin-top:22px"><a class="btn btn-a" href="${p.showForm ? '#demo' : c.L('/contact')}">${c.u('get_demo')}</a></div></div></section>
  <div class="wrap ${p.showForm ? 'detail' : ''}" style="${p.showForm ? '' : 'max-width:900px;padding:50px 20px 70px'}">
    <article class="prose">${p.image ? img(p.image, c.t(p.title), { eager: true, cls: 'cover' }) : ''}${md(c.t(p.content), c)}</article>
    ${p.showForm ? `<aside class="sideform" id="demo"><h2>${c.u('request_demo')}</h2><p>${c.u('interested_p')}</p>${leadForm(c, 'contact', '', 'pg')}</aside>` : ''}
  </div>
  ${sec('solutions') ? `<section class="s alt"><div class="wrap">${sh(c.u('sol_k'), c.u('sol_h'))}<div class="grid3">${visible(db.solutions).filter((s) => s.featured).slice(0, 6).map((s) => solCard(c, s)).join('')}</div></div></section>` : ''}`;
  return layout(c, { path: '/' + p.slug, title: c.t(p.seoTitle) || `${c.t(p.title)} | ${db.settings.siteName}`, desc: c.t(p.seoDescription) || c.t(p.intro), image: p.image, body,
    jsonld: [breadcrumbLd(bc), { '@context': 'https://schema.org', '@type': 'WebPage', name: c.t(p.title), url: abs(c.L('/' + p.slug)), inLanguage: c.lang === 'bn' ? 'bn-BD' : 'en', isPartOf: { '@id': CONFIG.SITE_URL + '/#website' }, about: { '@id': ORG_ID() } }, localLd(c)],
    page: { type: 'page', id: p.slug } });
}

function pageContact(c) {
  const bc = [{ name: c.u('home'), url: c.L('/') }, { name: c.u('nav_contact'), url: c.L('/contact') }];
  const body = `<section class="phero"><div class="wrap">${crumbs(c, bc)}<h1>${c.u('ct_h')}</h1><p>${c.u('ct_p')}</p></div></section>
  <section class="s"><div class="wrap"><div class="contact">${contactInfo(c, 'h2')}${leadForm(c, 'contact', '', 'cp')}</div>${mapEmbed(c)}</div></section>
  ${visible(db.faqs).length ? `<section class="s alt"><div class="wrap">${sh(c.u('faq_k'), c.u('faq_h'))}<div class="faq">${visible(db.faqs).map((f) => `<details><summary>${esc(c.t(f.q))}</summary><p>${esc(c.t(f.a))}</p></details>`).join('')}</div></div></section>` : ''}`;
  return layout(c, { path: '/contact', title: `${c.u('nav_contact')} — ${db.settings.siteName} | ${c.t(db.settings.tagline)}`, desc: `${c.u('ct_p')} ${c.u('phone')}: ${db.settings.phone}. ${c.t(db.settings.address)}`,
    body, jsonld: [breadcrumbLd(bc), localLd(c), { '@context': 'https://schema.org', '@type': 'ContactPage', name: c.u('nav_contact'), url: abs(c.L('/contact')), about: { '@id': ORG_ID() } }], page: { type: 'contact' } });
}

function pageError(c, code) {
  const body = `<div class="wrap nf"><b>${c.num(code)}</b><h1>${code === 410 ? c.u('gone_t') : c.u('nf_t')}</h1><p>${c.u('nf_p')}</p>
    <div class="cta" style="justify-content:center"><a class="btn btn-a" href="${c.L('/')}">${c.u('back_home')}</a><a class="btn btn-l" href="${c.L('/solutions')}">${c.u('all_solutions')}</a></div></div>
    <section class="s alt"><div class="wrap">${sh(c.u('sol_k'), c.u('sol_h'), '', 'h2')}<div class="grid3">${visible(db.solutions).filter((s) => s.featured).slice(0, 3).map((s) => solCard(c, s)).join('')}</div></div></section>`;
  return layout(c, { path: '/', noAlt: true, noindex: true, title: `${code} — ${code === 410 ? c.u('gone_t') : c.u('nf_t')} | ${db.settings.siteName}`, desc: c.u('nf_p'), body, page: { type: String(code) } });
}

/* ============================== META CONVERSIONS API ============================== */
const normPhone = (p) => { let d = String(p || '').replace(/\D/g, ''); if (/^01\d{9}$/.test(d)) d = '88' + d; return d; };
function metaCapi(eventName, req, { eventId, phone, email, url, custom } = {}) {
  const S = db.settings;
  if (!validPixel(S.metaPixelId) || !S.metaCapiToken) return;
  const ck = cookies(req);
  const ph = normPhone(phone);
  const body = { data: [{ event_name: eventName, event_time: Math.floor(Date.now() / 1000), event_id: eventId || undefined, action_source: 'website',
    event_source_url: url || CONFIG.SITE_URL + '/',
    user_data: { client_ip_address: req.ip, client_user_agent: req.headers['user-agent'] || '', fbp: ck._fbp || undefined, fbc: ck._fbc || undefined,
      ph: ph ? [sha256(ph)] : undefined, em: email ? [sha256(String(email).trim().toLowerCase())] : undefined, country: [sha256('bd')] },
    custom_data: custom || undefined }] };
  if (S.metaTestEventCode) body.test_event_code = S.metaTestEventCode;
  fetch(`https://graph.facebook.com/v21.0/${S.metaPixelId}/events?access_token=${encodeURIComponent(S.metaCapiToken)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000),
  }).then((r) => (r.ok ? null : r.text().then((t) => console.error('Meta CAPI error:', t.slice(0, 300))))).catch((e) => console.error('Meta CAPI error:', e.message));
}

/* ============================== SELF-HOSTED ANALYTICS ============================== */
const BOT_RE = /bot|crawl|spider|slurp|lighthouse|headless|preview|facebookexternalhit|whatsapp|telegram|curl|wget|python|axios|node-fetch|monitor|uptime|pingdom|semrush|ahrefs/i;
function parseUA(ua) {
  ua = String(ua || '');
  const device = /iPad|Tablet|SM-T|Tab(?!le)/i.test(ua) ? 'tablet' : /Mobi|Android|iPhone|iPod/i.test(ua) ? 'mobile' : 'desktop';
  const browser = /SamsungBrowser/i.test(ua) ? 'Samsung' : /OPR|Opera/i.test(ua) ? 'Opera' : /Edg/i.test(ua) ? 'Edge' : /FBAN|FBAV|FB_IAB/i.test(ua) ? 'Facebook app'
    : /Instagram/i.test(ua) ? 'Instagram app' : /UCBrowser/i.test(ua) ? 'UC Browser' : /Firefox|FxiOS/i.test(ua) ? 'Firefox' : /Chrome|CriOS/i.test(ua) ? 'Chrome' : /Safari/i.test(ua) ? 'Safari' : 'Other';
  const os = /Android/i.test(ua) ? 'Android' : /iPhone|iPad|iPod/i.test(ua) ? 'iOS' : /Windows/i.test(ua) ? 'Windows' : /Mac OS/i.test(ua) ? 'macOS' : /Linux/i.test(ua) ? 'Linux' : 'Other';
  return { device, browser, os };
}
const EVENT_TYPES = ['pageview', 'lead', 'whatsapp_click', 'call_click', 'email_click', 'demo_click', 'live_demo_click', 'outbound_click', 'form_start'];
async function trackEvent(req, b) {
  if (db.settings.selfAnalytics === false) return;
  const ua = req.headers['user-agent'] || '';
  if (BOT_RE.test(ua)) return;
  const type = EVENT_TYPES.includes(b.t) ? b.t : null;
  if (!type) return;
  const s = (x, n) => String(x || '').slice(0, n);
  let ref = '';
  try { if (b.r) { const h = new URL(b.r).hostname.replace(/^www\./, ''); if (h && h !== new URL(CONFIG.SITE_URL).hostname.replace(/^www\./, '') && h !== req.hostname) ref = h; } } catch {}
  const { device, browser, os } = parseUA(ua);
  await pool.query(`INSERT INTO bx_events (type, path, title, ref, utm_source, utm_medium, utm_campaign, visitor, session, device, browser, os, lang, label)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [type, s(b.p, 300), s(b.ti, 200), s(ref, 120), s(b.us, 80).toLowerCase(), s(b.um, 80).toLowerCase(), s(b.uc, 120), s(b.v, 40) || sha256(req.ip + ua).slice(0, 16),
      s(b.sid, 40) || 'na', device, browser, os, b.l === 'en' ? 'en' : 'bn', s(b.lb, 160)]);
}
setInterval(() => pool.query(`DELETE FROM bx_events WHERE ts < now() - ($1 || ' days')::interval`, [String(CONFIG.ANALYTICS_KEEP_DAYS)]).catch(() => {}), 6 * 3600e3).unref();

async function analyticsReport(days) {
  days = Math.max(1, Math.min(365, Number(days) || 30));
  const tz = CONFIG.TIMEZONE;
  const st = await pool.query(`SELECT (date_trunc('day', now() AT TIME ZONE $1) - ($2::int - 1) * interval '1 day') AT TIME ZONE $1 AS start`, [tz, days]);
  const start = st.rows[0].start;
  const prevStart = new Date(new Date(start).getTime() - days * 864e5);
  const q = (sql, p = []) => pool.query(sql, [start, ...p]).then((r) => r.rows);
  const [tot, prev, daily, pages, refs, utm, devices, browsers, oses, langs, events, live, leads, leadsPrev, leadSrc, entry] = await Promise.all([
    q(`SELECT count(*) FILTER (WHERE type='pageview')::int pv, count(DISTINCT visitor) FILTER (WHERE type='pageview')::int uv, count(DISTINCT session) FILTER (WHERE type='pageview')::int ss FROM bx_events WHERE ts >= $1`),
    pool.query(`SELECT count(*) FILTER (WHERE type='pageview')::int pv, count(DISTINCT visitor) FILTER (WHERE type='pageview')::int uv FROM bx_events WHERE ts >= $1 AND ts < $2`, [prevStart, start]).then((r) => r.rows),
    q(`SELECT to_char(ts AT TIME ZONE $2, 'YYYY-MM-DD') d, count(*) FILTER (WHERE type='pageview')::int pv, count(DISTINCT visitor) FILTER (WHERE type='pageview')::int uv FROM bx_events WHERE ts >= $1 GROUP BY 1 ORDER BY 1`, [tz]),
    q(`SELECT path, max(title) title, count(*)::int pv, count(DISTINCT visitor)::int uv FROM bx_events WHERE ts >= $1 AND type='pageview' GROUP BY path ORDER BY pv DESC LIMIT 20`),
    q(`SELECT ref, count(DISTINCT session)::int n FROM bx_events WHERE ts >= $1 AND type='pageview' AND ref <> '' GROUP BY ref ORDER BY n DESC LIMIT 15`),
    q(`SELECT utm_source s, utm_medium m, utm_campaign c, count(DISTINCT session)::int n FROM bx_events WHERE ts >= $1 AND type='pageview' AND utm_source <> '' GROUP BY 1,2,3 ORDER BY n DESC LIMIT 15`),
    q(`SELECT device k, count(DISTINCT visitor)::int n FROM bx_events WHERE ts >= $1 AND type='pageview' GROUP BY 1 ORDER BY n DESC`),
    q(`SELECT browser k, count(DISTINCT visitor)::int n FROM bx_events WHERE ts >= $1 AND type='pageview' GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    q(`SELECT os k, count(DISTINCT visitor)::int n FROM bx_events WHERE ts >= $1 AND type='pageview' GROUP BY 1 ORDER BY n DESC`),
    q(`SELECT lang k, count(DISTINCT visitor)::int n FROM bx_events WHERE ts >= $1 AND type='pageview' GROUP BY 1 ORDER BY n DESC`),
    q(`SELECT type k, count(*)::int n FROM bx_events WHERE ts >= $1 AND type <> 'pageview' GROUP BY 1 ORDER BY n DESC`),
    pool.query(`SELECT count(DISTINCT visitor)::int n FROM bx_events WHERE ts > now() - interval '5 minutes'`).then((r) => r.rows),
    q(`SELECT count(*)::int n FROM bx_leads WHERE created_at >= $1`),
    pool.query(`SELECT count(*)::int n FROM bx_leads WHERE created_at >= $1 AND created_at < $2`, [prevStart, start]).then((r) => r.rows),
    q(`SELECT COALESCE(NULLIF(utm_source,''), NULLIF(referrer,''), '(direct)') k, count(*)::int n FROM bx_leads WHERE created_at >= $1 GROUP BY 1 ORDER BY n DESC LIMIT 10`),
    q(`SELECT path, count(*)::int n FROM (SELECT DISTINCT ON (session) session, path FROM bx_events WHERE ts >= $1 AND type='pageview' ORDER BY session, ts) x GROUP BY path ORDER BY n DESC LIMIT 10`),
  ]);
  // fill missing days
  const map = Object.fromEntries(daily.map((d) => [d.d, d]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 864e5).toLocaleDateString('en-CA', { timeZone: tz });
    series.push(map[d] || { d, pv: 0, uv: 0 });
  }
  return { days, totals: { ...tot[0], leads: leads[0].n }, previous: { ...prev[0], leads: leadsPrev[0].n }, series, pages, refs, utm, devices, browsers, oses, langs, events, live: live[0].n, leadSources: leadSrc, entryPages: entry };
}

/* ============================== LEADS ============================== */
async function saveLead(req, b) {
  if (b.website) return { ok: true, skip: true }; // honeypot
  if (limited('lead:' + req.ip, 5, 10 * 60e3)) return { error: 'too_many', status: 429 };
  const str = (x, n) => String(x || '').trim().slice(0, n);
  const phone = str(b.phone, 40).replace(/[০-৯]/g, (d) => '০১২৩৪৫৬৭৮৯'.indexOf(d));
  const lead = {
    id: uid(), type: b.type === 'demo' ? 'demo' : 'contact',
    name: str(b.name, 120), phone, email: str(b.email, 160), company: str(b.company, 160),
    solution: str(b.solution, 160), message: str(b.message, 3000), lang: b.lang === 'en' ? 'en' : 'bn',
    status: 'new', note: '', ip: req.ip, utmSource: str(b.us, 80).toLowerCase(), utmMedium: str(b.um, 80).toLowerCase(), utmCampaign: str(b.uc, 120),
    page: str(b.page, 300), referrer: (() => { try { return b.ref ? new URL(b.ref).hostname.replace(/^www\./, '') : ''; } catch { return ''; } })(), createdAt: now(),
  };
  if (!lead.name || !/^[+0-9\s-]{6,20}$/.test(lead.phone)) return { error: 'invalid', status: 400 };
  if (lead.email && !/^\S+@\S+\.\S+$/.test(lead.email)) return { error: 'invalid', status: 400 };
  await persistLead(lead);
  db.leads.unshift(lead);
  metaCapi('Lead', req, { eventId: str(b.eid, 64), phone: lead.phone, email: lead.email, url: CONFIG.SITE_URL + (lead.page || '/'), custom: { content_name: lead.solution || lead.type } });
  return { ok: true };
}

/* ============================== APP ============================== */
function asyncSafe(router) {
  for (const m of ['get', 'post', 'put', 'delete', 'use']) {
    const orig = router[m].bind(router);
    router[m] = (...args) => (m === 'get' && args.length === 1 ? orig(...args) : orig(...args.map((h) => (typeof h === 'function' && h.length < 4 ? (req, res, next) => {
      try { const r = h(req, res, next); if (r && typeof r.catch === 'function') r.catch(next); } catch (e) { next(e); }
    } : h))));
  }
  return router;
}
const app = asyncSafe(express());
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(compression());
// canonical host + https
app.use((req, res, next) => {
  const target = new URL(CONFIG.SITE_URL);
  const host = String(req.headers.host || '').toLowerCase();
  const bare = target.host.replace(/^www\./, '');
  if (CONFIG.FORCE_CANONICAL_HOST && host !== target.host && (host === 'www.' + bare || host === bare)) return res.redirect(301, CONFIG.SITE_URL + req.originalUrl);
  if (CONFIG.FORCE_HTTPS && host === target.host && req.headers['x-forwarded-proto'] === 'http') return res.redirect(301, CONFIG.SITE_URL + req.originalUrl);
  next();
});
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  next();
});
app.use(express.json({ limit: '6mb' }));
app.use('/assets', express.static(path.join(CONFIG.PUBLIC_DIR, 'assets'), { maxAge: '365d', immutable: true }));
app.get('/favicon.ico', (req, res) => res.redirect(301, safeUrl(db.settings.favicon) || '/assets/favicon.png'));

app.get('/uploads/:file', async (req, res) => {
  const r = await pool.query('SELECT mime, data FROM bx_media WHERE id = $1', [path.basename(req.params.file)]);
  if (!r.rows.length) return res.status(404).end();
  res.setHeader('Content-Type', r.rows[0].mime);
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'");
  res.end(r.rows[0].data);
});

/* ---------- robots / sitemap / rss ---------- */
app.get('/robots.txt', (req, res) => res.type('text/plain').send(`User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/\nDisallow: /lead\n\nSitemap: ${CONFIG.SITE_URL}/sitemap.xml\n`));
app.get('/sitemap.xml', (req, res) => {
  const entries = [];
  const add = (p, lastmod, images = [], prio) => entries.push({ p, lastmod, images, prio });
  const newest = (arr) => arr.map((x) => x.updatedAt || x.createdAt || '').sort().pop() || now();
  add('/', newest([...db.solutions, ...db.posts, { updatedAt: now().slice(0, 10) }]), [safeUrl(db.settings.ogImage) || '/assets/og-image.jpg'], '1.0');
  add('/solutions', newest(db.solutions), [], '0.9');
  for (const c of usedCats()) add('/category/' + c.id, newest(db.solutions.filter((s) => s.category === c.id)), [], '0.8');
  for (const s of visible(db.solutions)) add('/solutions/' + s.slug, s.updatedAt || s.createdAt, [s.image, ...(s.gallery || [])].filter(Boolean), '0.8');
  if (publishedPosts().length) add('/blog', newest(publishedPosts()), [], '0.7');
  for (const p of publishedPosts()) add('/blog/' + p.slug, p.updatedAt || p.publishedAt, [p.cover].filter(Boolean), '0.7');
  for (const p of visible(db.pages)) add('/' + p.slug, p.updatedAt || p.createdAt, [p.image].filter(Boolean), '0.8');
  add('/contact', newest([{ updatedAt: db.settings._updatedAt || now().slice(0, 10) }]), [], '0.6');
  const xml = entries.flatMap((e) => LANGS.map((lang) => `<url><loc>${esc(abs(L(lang, e.p)))}</loc>${e.lastmod ? `<lastmod>${esc(String(e.lastmod).slice(0, 10))}</lastmod>` : ''}<priority>${e.prio}</priority>${
    LANGS.map((l) => `<xhtml:link rel="alternate" hreflang="${l}" href="${esc(abs(L(l, e.p)))}"/>`).join('')}<xhtml:link rel="alternate" hreflang="x-default" href="${esc(abs(L(DEF(), e.p)))}"/>${
    e.images.map((i) => `<image:image><image:loc>${esc(absAsset(i))}</image:loc></image:image>`).join('')}</url>`));
  res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${xml.join('\n')}\n</urlset>`);
});
function rss(lang, res) {
  const c = ctxFor(lang);
  const items = publishedPosts().slice(0, 30).map((p) => `<item><title>${esc(c.t(p.title))}</title><link>${esc(abs(c.L('/blog/' + p.slug)))}</link><guid isPermaLink="true">${esc(abs(c.L('/blog/' + p.slug)))}</guid><pubDate>${new Date(p.publishedAt).toUTCString()}</pubDate><description>${esc(c.t(p.excerpt) || clip(stripMd(c.t(p.content)), 300))}</description></item>`).join('\n');
  res.type('application/rss+xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel><title>${esc(db.settings.siteName)} — ${esc(c.u('nav_blog'))}</title><link>${esc(abs(c.L('/blog')))}</link><atom:link href="${esc(abs(c.L('/rss.xml')))}" rel="self" type="application/rss+xml"/><description>${esc(c.u('blog_p'))}</description><language>${lang === 'bn' ? 'bn-BD' : 'en'}</language>\n${items}\n</channel></rss>`);
}

/* ---------- Public APIs ---------- */
app.get('/api/public', (req, res) => {
  const { headScripts, bodyScripts, metaCapiToken, metaTestEventCode, ...s } = db.settings;
  res.json({ settings: s, categories: db.categories, solutions: visible(db.solutions), posts: publishedPosts().map(({ content, ...p }) => p) });
});
app.post('/api/lead', async (req, res) => {
  const r = await saveLead(req, req.body || {});
  if (r.error) return res.status(r.status).json({ error: r.error });
  res.json({ ok: true });
});
// no-JS fallback for the forms
app.post('/lead', express.urlencoded({ extended: false, limit: '20kb' }), async (req, res) => {
  const r = await saveLead(req, req.body || {});
  let back = '/';
  try { const u = new URL(req.headers.referer || '/', CONFIG.SITE_URL); back = u.pathname; } catch {}
  res.redirect(303, back + (r.error ? '?sent=0' : '?sent=1') + '#contact');
});
app.post('/api/t', (req, res) => {
  res.status(204).end();
  if (limited('t:' + req.ip, 120, 60e3)) return;
  const b = req.body || {};
  trackEvent(req, b).catch((e) => console.error('track:', e.message));
  if (b.t === 'pageview' && b.vc && b.pt === 'solution') metaCapi('ViewContent', req, { eventId: String(b.vc).slice(0, 64), url: CONFIG.SITE_URL + String(b.p || '/'), custom: { content_name: String(b.lb || '').slice(0, 160), content_type: 'product' } });
  if ((b.t === 'whatsapp_click' || b.t === 'call_click') && b.ce) metaCapi('Contact', req, { eventId: String(b.ce).slice(0, 64), url: CONFIG.SITE_URL + String(b.p || '/') });
});

/* ---------- Admin page ---------- */
app.get('/admin', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(CONFIG.PUBLIC_DIR, 'admin.html'));
});

/* ---------- Admin API ---------- */
const A = asyncSafe(express.Router());
A.use((req, res, next) => { res.setHeader('X-Robots-Tag', 'noindex'); res.setHeader('Cache-Control', 'no-store'); next(); });
A.use(sameOrigin);
A.post('/login', async (req, res) => {
  const { username, password } = req.body || {};
  if (limited('login:' + req.ip, 8, 15 * 60e3)) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  const a = db.admins.find((x) => x.username === String(username || '').trim());
  if (!a || !checkPassword(password || '', a.salt, a.hash)) return res.status(401).json({ error: 'Wrong username or password' });
  a.lastLogin = now(); await persistAdmin(a);
  setSession(req, res, makeToken(a), CONFIG.SESSION_HOURS * 3600);
  res.json({ ok: true, mustChange: !!a.mustChange });
});
A.post('/logout', (req, res) => { setSession(req, res, '', 0); res.json({ ok: true }); });
A.use(auth);
const adminView = (a) => ({ id: a.id, username: a.username, name: a.name, mustChange: !!a.mustChange, lastLogin: a.lastLogin, createdAt: a.createdAt });
A.get('/me', (req, res) => res.json(adminView(req.admin)));
A.get('/data', (req, res) => {
  const { secret, admins, ...rest } = db;
  res.json({ ...rest, admins: admins.map(adminView), siteUrl: CONFIG.SITE_URL, defLang: DEF() });
});
A.get('/analytics', async (req, res) => res.json(await analyticsReport(req.query.days)));
A.put('/settings', async (req, res) => {
  const incoming = clean(req.body || {});
  for (const k of ['logo', 'logoDark', 'favicon', 'heroImage', 'ogImage', 'facebook', 'youtube', 'linkedin', 'instagram'])
    if (k in incoming) incoming[k] = safeUrl(incoming[k]);
  if ('defaultLang' in incoming && !LANGS.includes(incoming.defaultLang)) delete incoming.defaultLang;
  for (const [k, ok] of [['ga4Id', validGA], ['gtmId', validGTM], ['metaPixelId', validPixel]])
    if (k in incoming) { incoming[k] = String(incoming[k]).trim(); if (incoming[k] && !ok(incoming[k])) return res.status(400).json({ error: `Invalid ${k}` }); }
  db.settings = { ...db.settings, ...incoming, _updatedAt: now().slice(0, 10) };
  await persistSettings();
  res.json(db.settings);
});
for (const [name, fields] of Object.entries(COLLECTIONS)) {
  A.post(`/${name}/reorder`, async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    ids.forEach((id, i) => { const it = db[name].find((x) => x.id === id); if (it) it.order = i + 1; });
    db[name].sort((a, b) => (a.order || 0) - (b.order || 0));
    await persistOrder(name); res.json({ ok: true });
  });
  A.post(`/${name}`, async (req, res) => {
    const item = { id: name === 'categories' && req.body?.id ? slugify(req.body.id) : uid(), ...pick(req.body, fields), createdAt: now() };
    if (name === 'categories' && db.categories.some((c) => c.id === item.id)) item.id = item.id + '-' + uid().slice(0, 4);
    normalise(name, item);
    if (item.order === undefined || item.order === '') item.order = db[name].length + 1;
    await persistItem(name, item); item.updatedAt = now(); db[name].push(item); res.json(item);
  });
  A.put(`/${name}/:id`, async (req, res) => {
    const item = db[name].find((x) => x.id === req.params.id);
    if (!item) return res.status(404).json({ error: 'Not found' });
    const oldSlug = item.slug;
    Object.assign(item, pick(req.body, fields), { updatedAt: now() });
    normalise(name, item);
    await persistItem(name, item);
    if (SLUG_BASE[name] && oldSlug && oldSlug !== item.slug) await addRedirect(SLUG_BASE[name] + oldSlug, SLUG_BASE[name] + item.slug);
    res.json(item);
  });
  A.delete(`/${name}/:id`, async (req, res) => {
    if (name === 'categories' && db.solutions.some((s) => s.category === req.params.id))
      return res.status(400).json({ error: 'This category still has solutions. Move or delete them first.' });
    const item = db[name].find((x) => x.id === req.params.id);
    await removeItem(name, req.params.id); db[name] = db[name].filter((x) => x.id !== req.params.id);
    if (item && SLUG_BASE[name] && item.slug) await addRedirect(SLUG_BASE[name] + item.slug, '', '410');
    if (item && name === 'categories') await addRedirect('/category/' + item.id, '/solutions');
    res.json({ ok: true });
  });
}
A.put('/leads/:id', async (req, res) => {
  const l = db.leads.find((x) => x.id === req.params.id);
  if (!l) return res.status(404).json({ error: 'Not found' });
  if (['new', 'contacted', 'demo', 'won', 'lost'].includes(req.body?.status)) l.status = req.body.status;
  if (typeof req.body?.note === 'string') l.note = req.body.note.slice(0, 5000);
  l.updatedAt = now(); await persistLead(l); res.json(l);
});
A.delete('/leads/:id', async (req, res) => { await removeLead(req.params.id); db.leads = db.leads.filter((x) => x.id !== req.params.id); res.json({ ok: true }); });
A.get('/leads.csv', (req, res) => {
  const cols = ['createdAt', 'type', 'status', 'name', 'phone', 'email', 'company', 'solution', 'message', 'note', 'lang', 'utmSource', 'utmMedium', 'utmCampaign', 'referrer', 'page'];
  const cell = (v) => { let s = String(v ?? ''); if (/^[=+\-@]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  const csv = '\uFEFF' + [cols.join(','), ...db.leads.map((l) => cols.map((c) => cell(l[c])).join(','))].join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="baybex-leads-${now().slice(0, 10)}.csv"`);
  res.send(csv);
});

/* ---------- Uploads (stored in PostgreSQL, table bx_media) ---------- */
const ALLOWED = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif', 'image/svg+xml': '.svg', 'image/x-icon': '.ico', 'image/vnd.microsoft.icon': '.ico' };
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: CONFIG.MAX_UPLOAD_MB * 1024 * 1024 }, fileFilter: (req, file, cb) => cb(null, !!ALLOWED[file.mimetype]) });
A.post('/upload', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    try {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Only PNG, JPG, WEBP, AVIF, GIF, SVG or ICO images are allowed' });
      if (req.file.mimetype === 'image/svg+xml' && /<script|on\w+\s*=|javascript:|<foreignObject/i.test(req.file.buffer.toString('utf8')))
        return res.status(400).json({ error: 'SVG contains scripts — not allowed' });
      let w = null, h = null;
      try { const d = sizeOf(req.file.buffer); w = d.width || null; h = d.height || null; } catch {}
      // SEO-friendly file name: original name slug + short random suffix
      const base = slugify(path.parse(req.file.originalname || 'image').name).replace(/[^\w-]/g, '').slice(0, 50) || 'image';
      const id = `${base}-${crypto.randomBytes(3).toString('hex')}${ALLOWED[req.file.mimetype]}`;
      await pool.query('INSERT INTO bx_media (id, mime, size, data, width, height) VALUES ($1,$2,$3,$4,$5,$6)', [id, req.file.mimetype, req.file.size, req.file.buffer, w, h]);
      if (w && h) mediaDims.set('/uploads/' + id, { w, h });
      res.json({ url: '/uploads/' + id, width: w, height: h, size: req.file.size });
    } catch (e) { next(e); }
  });
});
A.get('/uploads', async (req, res) => {
  const r = await pool.query('SELECT id, size, width, height, created_at FROM bx_media ORDER BY created_at DESC');
  res.json(r.rows.map((x) => ({ url: '/uploads/' + x.id, size: x.size, width: x.width, height: x.height, time: new Date(x.created_at).getTime() })));
});
A.delete('/uploads/:file', async (req, res) => {
  await pool.query('DELETE FROM bx_media WHERE id = $1', [path.basename(req.params.file)]);
  mediaDims.delete('/uploads/' + path.basename(req.params.file));
  res.json({ ok: true });
});

/* ---------- Admin users ---------- */
A.post('/admins', async (req, res) => {
  const username = String(req.body?.username || '').trim();
  const password = String(req.body?.password || '');
  if (!/^[a-zA-Z0-9_.-]{3,30}$/.test(username)) return res.status(400).json({ error: 'Username: 3–30 letters, numbers, _ . -' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  if (db.admins.some((a) => a.username === username)) return res.status(400).json({ error: 'Username already exists' });
  const { salt, hash } = hashPassword(password);
  const a = { id: uid(), username, name: String(req.body?.name || username).slice(0, 80), salt, hash, tv: 1, mustChange: false, createdAt: now() };
  await persistAdmin(a); db.admins.push(a); res.json(adminView(a));
});
A.delete('/admins/:id', async (req, res) => {
  if (req.params.id === req.admin.id) return res.status(400).json({ error: 'You cannot delete yourself' });
  if (db.admins.length <= 1) return res.status(400).json({ error: 'At least one admin is required' });
  await removeAdmin(req.params.id); db.admins = db.admins.filter((a) => a.id !== req.params.id); res.json({ ok: true });
});
A.post('/password', async (req, res) => {
  const { current, next: nw } = req.body || {};
  const a = req.admin;
  if (!checkPassword(current || '', a.salt, a.hash)) return res.status(400).json({ error: 'Current password is wrong' });
  if (String(nw || '').length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });
  if (nw === CONFIG.DEFAULT_ADMIN_PASS) return res.status(400).json({ error: 'Choose a password different from the default' });
  Object.assign(a, hashPassword(nw)); a.tv = (a.tv || 1) + 1; a.mustChange = false; await persistAdmin(a);
  setSession(req, res, makeToken(a), CONFIG.SESSION_HOURS * 3600);
  res.json({ ok: true });
});

/* ---------- Backup / restore ---------- */
A.get('/backup', (req, res) => {
  const { secret, admins, ...rest } = db;
  res.setHeader('Content-Disposition', `attachment; filename="baybexai-backup-${now().slice(0, 10)}.json"`);
  res.json(rest);
});
A.post('/restore', async (req, res) => {
  const b = req.body || {};
  if (!b.settings || !Array.isArray(b.solutions)) return res.status(400).json({ error: 'This is not a BaybexAI backup file' });
  const next = { ...seed(), ...clean(b), secret: db.secret, admins: db.admins };
  for (const k of [...CONTENT, 'leads']) if (!Array.isArray(next[k])) next[k] = [];
  await writeAll(next); await loadAll(); res.json({ ok: true });
});
app.use('/api/admin', A);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

/* ============================== PUBLIC PAGE ROUTER ============================== */
function sendHtml(res, html, status = 200) {
  res.status(status);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', status === 200 ? 'public, max-age=0, must-revalidate' : 'no-cache');
  res.send(html);
}
app.get('*', (req, res) => {
  const rawPath = decodeSafe(req.path);
  const qs = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
  // legacy ?lang=xx → language URL
  if (LANGS.includes(req.query.lang)) {
    const rest = rawPath.replace(/^\/(en|bn)(?=\/|$)/, '').replace(/^\/solution\//, '/solutions/') || '/';
    return res.redirect(301, L(req.query.lang, rest === '' ? '/' : rest));
  }
  // trailing slash → none
  if (rawPath.length > 1 && rawPath.endsWith('/')) return res.redirect(301, encodeURI(rawPath.replace(/\/+$/, '')) + qs);
  // uppercase → lowercase (ascii paths only)
  if (/[A-Z]/.test(rawPath) && !/[^\x00-\x7F]/.test(rawPath)) return res.redirect(301, rawPath.toLowerCase() + qs);
  let lang = DEF(), rest = rawPath;
  const m = rawPath.match(/^\/(en|bn)(\/.*)?$/);
  if (m) {
    lang = m[1]; rest = m[2] || '/';
    if (lang === DEF()) return res.redirect(301, encodeURI(rest) + qs);
  }
  const c = ctxFor(lang);
  const seg = rest.split('/').filter(Boolean);
  let html = null;
  if (seg.length === 0) html = pageHome(c);
  else if (seg[0] === 'rss.xml' && seg.length === 1) return rss(lang, res);
  else if (seg[0] === 'solution' && seg.length === 2) return res.redirect(301, encodeURI(c.L('/solutions/' + seg[1])));
  else if (seg[0] === 'solutions' && seg.length === 1) html = pageSolutions(c);
  else if (seg[0] === 'solutions' && seg.length === 2) { const s = visible(db.solutions).find((x) => x.slug === seg[1]); if (s) html = pageSolution(c, s); }
  else if (seg[0] === 'category' && seg.length === 2) { const x = usedCats().find((k) => k.id === seg[1]); if (x) html = pageCategory(c, x); }
  else if (seg[0] === 'blog' && seg.length === 1) {
    const pg = Number(req.query.page || 1);
    if (!Number.isInteger(pg) || pg < 1) return res.redirect(301, c.L('/blog'));
    if (pg === 1 && req.query.page) return res.redirect(301, c.L('/blog'));
    if (publishedPosts().length) html = pageBlog(c, pg);
  }
  else if (seg[0] === 'blog' && seg.length === 2) { const p = publishedPosts().find((x) => x.slug === seg[1]); if (p) html = pagePost(c, p); }
  else if (seg[0] === 'contact' && seg.length === 1) html = pageContact(c);
  else if (seg.length === 1) { const p = visible(db.pages).find((x) => x.slug === seg[0]); if (p) html = pageCustom(c, p); }
  if (html) return sendHtml(res, html);
  // managed redirects (and 410 Gone for deleted pages)
  const r = db.redirects.find((x) => x.from === rest);
  if (r) {
    if (r.code === '410') return sendHtml(res, pageError(c, 410), 410);
    const to = /^https?:\/\//.test(r.to) ? r.to : encodeURI(c.L(r.to || '/'));
    return res.redirect(r.code === '302' ? 302 : 301, to);
  }
  sendHtml(res, pageError(c, 404), 404);
});
app.use((req, res) => res.status(404).end());
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') return res.status(400).json({ error: 'Bad request' });
  console.error(err);
  if (req.path.startsWith('/api/')) return res.status(500).json({ error: 'Server error' });
  res.status(500).send('Server error');
});

initDb()
  .then(() => app.listen(CONFIG.PORT, CONFIG.HOST, () => console.log(`BaybexAI running on http://localhost:${CONFIG.PORT}  (admin: /admin) — PostgreSQL connected`)))
  .catch((e) => { console.error('Could not connect to PostgreSQL:', e.message); process.exit(1); });
