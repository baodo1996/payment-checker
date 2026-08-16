/**
 * 🔄 SMART CONVERTER
 * Biến raw text (chat, email, Excel, note...) → order-data.json chuẩn
 * 
 * Hỗ trợ các định dạng:
 * 1. Free-form: "Nguyễn Văn A, 0901234567, test@gmail.com, 123 Nguyễn Huệ..."
 * 2. Labeled: "Họ tên: Nguyễn Văn A\nSĐT: 0901234567\nĐịa chỉ: 123 Nguyễn Huệ..."
 * 3. Template: Dùng template pattern để match
 */

// ──── VIETNAMESE CITY NAMES ────
const VIETNAMESE_CITIES = [
  'hà nội', 'tp. hồ chí minh', 'tp.hcm', 'hồ chí minh', 'sài gòn', 'saigon',
  'đà nẵng', 'hải phòng', 'cần thơ', 'biên hòa', 'nha trang', 'huế',
  'vũng tàu', 'buôn ma thuột', 'đà lạt', 'quy nhơn', 'hạ long',
  'thanh hóa', 'vinh', 'nam định', 'thái nguyên', 'việt trì', 'bắc ninh',
  'hải dương', 'phan thiết', 'long xuyên', 'ràch giá', 'cà mau',
  'thủ dầu một', 'mỹ tho', 'tân an', 'bến tre', 'trà vinh', 'sóc trăng',
  'bạc liêu', 'vĩnh long', 'sa đéc', 'cao lãnh', 'tây ninh',
  'hà nội', 'hcm', 'tp.hcm', 'tphcm', 'tp hcm'
];

// ──── REGEX PATTERNS ────
const PATTERNS = {
  phone:      /((?:0|\+84|84)[0-9]{8,10})\b/g,
  email:      /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
  cardNumber: /(\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4})/g,
  cardExpiry: /(\d{2}\/\d{2,4})/g,
  cvv:        /\b(?:cvv|cvc|csc|cid|security)[:\s]*(\d{3,4})\b/i,
  zipCode:    /\b(?:zip|postal|postcode)[:\s]*(\d{4,6})\b/i,
  quantity:   /\b(?:số lượng|sl|qty|quantity)[:\s]*(\d+)\b/i,
};

// ──── VIETNAMESE ADDRESS PATTERNS ────
const ADDRESS_PATTERNS = {
  district: /\b(quận|huyện|q\.|h\.)\s*([a-zA-ZÀ-ỹ0-9\s]+?)(?:,|$|\.|\n)/i,
  ward:     /\b(phường|ph\.|xã|p\.)\s*([a-zA-ZÀ-ỹ0-9\s]+?)(?:,|$|\.|\n)/i,
  street:   /(?:số\s*)?(\d+[a-zA-Z]?\s+(?:đường|phố|ngõ|hẻm|ngách|kiệt|ấp|tổ|khu)\s*[a-zA-ZÀ-ỹ0-9\s]+?)(?:,|$|\.|\n)|(\d+[A-Za-z]?\s+[A-ZÀ-Ỹ][a-zà-ỹ]+(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]+){1,3})(?:,|$|\.|\n)/i,
  city:     new RegExp(`(?:tp\\.?\\s*|thành phố\\s*|tỉnh\\s*)?(${VIETNAMESE_CITIES.join('|')})`, 'i'),
};

// ──── LABEL PATTERNS (Key: Value format) ────
const LABEL_MAP = {
  'họ tên': 'fullName', 'ho ten': 'fullName', 'hoten': 'fullName', 'tên': 'fullName', 'ten': 'fullName',
  'full name': 'fullName', 'fullname': 'fullName', 'name': 'fullName',
  
  'tên (first)': 'firstName', 'first name': 'firstName', 'firstname': 'firstName',
  'họ (last)': 'lastName', 'last name': 'lastName', 'lastname': 'lastName',
  
  'email': 'email', 'e-mail': 'email', 'mail': 'email',
  'sđt': 'phone', 'sdt': 'phone', 'điện thoại': 'phone', 'dien thoai': 'phone',
  'phone': 'phone', 'mobile': 'phone', 'tel': 'phone', 'số điện thoại': 'phone',
  
  'địa chỉ': 'street', 'dia chi': 'street', 'address': 'street', 'số nhà': 'street',
  'đường': 'street', 'duong': 'street',
  
  'phường': 'ward', 'phuong': 'ward', 'xã': 'ward', 'xa': 'ward', 'ward': 'ward',
  'quận': 'district', 'quan': 'district', 'huyện': 'district', 'huyen': 'district', 'district': 'district',
  
  'thành phố': 'city', 'thanh pho': 'city', 'tỉnh': 'city', 'tinh': 'city',
  'city': 'city', 'province': 'city', 'tp': 'city',
  
  'số thẻ': 'cardNumber', 'so the': 'cardNumber', 'card number': 'cardNumber', 'cardnumber': 'cardNumber',
  'thẻ': 'cardNumber', 'the': 'cardNumber',
  
  'tên chủ thẻ': 'cardHolderName', 'ten chu the': 'cardHolderName', 'card holder': 'cardHolderName',
  'chủ thẻ': 'cardHolderName', 'chu the': 'cardHolderName',
  
  'ngày hết hạn': 'cardExpiry', 'ngay het han': 'cardExpiry', 'expiry': 'cardExpiry',
  'exp': 'cardExpiry', 'hết hạn': 'cardExpiry', 'het han': 'cardExpiry',
  
  'cvv': 'cardCVV', 'cvc': 'cardCVV', 'mã bảo mật': 'cardCVV', 'ma bao mat': 'cardCVV',
  'security code': 'cardCVV',
  
  'ghi chú': 'note', 'ghi chu': 'note', 'note': 'note', 'notes': 'note',
  'lời nhắn': 'note', 'loi nhan': 'note', 'message': 'note',
  
  'url': 'url', 'link': 'url', 'website': 'url', 'checkout': 'url',
  'trang thanh toán': 'url', 'trang thanh toan': 'url',
};

// ──── MAIN CONVERT ────

/**
 * Convert raw text input → order-data.json format
 * @param {string} rawText - Input text từ user
 * @returns {Object} - order-data.json structure
 */
function convertRawToOrderData(rawText) {
  if (!rawText || !rawText.trim()) return null;

  const text = rawText.trim();
  
  // Detect format type
  const isLabeled = detectLabeledFormat(text);
  const isStructured = detectStructuredFormat(text);
  
  let parsed;
  if (isLabeled) {
    parsed = parseLabeledText(text);
  } else if (isStructured) {
    parsed = parseStructuredText(text);
  } else {
    parsed = parseFreeFormText(text);
  }

  // Build order-data.json structure
  return buildOrderData(parsed);
}

/**
 * Detect if text is labeled format (Key: Value each line)
 */
function detectLabeledFormat(text) {
  const lines = text.split('\n').filter(l => l.trim());
  const knownKeys = new Set(Object.keys(LABEL_MAP));
  let labeledCount = 0;
  for (const line of lines) {
    const match = line.match(/^([a-zA-ZÀ-ỹ0-9\s()]+)[:=]\s*(.+)/i) ||
                  line.match(/^([a-zA-ZÀ-ỹ0-9\s()]+)\s*[-—–]\s*(.+)/i);
    if (match) {
      const key = match[1].trim().toLowerCase();
      // Only count if the key looks like a known label OR has value
      if (knownKeys.has(key) || key.length <= 20) labeledCount++;
    }
  }
  return labeledCount >= lines.length * 0.4; // 40% labeled lines
}

/**
 * Detect structured format (CSV-like, pipe-separated, etc.)
 */
function detectStructuredFormat(text) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return false;
  
  // Check for comma or pipe separated with consistent column count
  const firstCols = lines[0].split(/[,|;]/).length;
  if (firstCols >= 3) {
    return lines.every(l => l.split(/[,|;]/).length === firstCols);
  }
  return false;
}

/**
 * Parse labeled text: "Họ tên: Nguyễn Văn A\nSĐT: 0901234567"
 */
function parseLabeledText(text) {
  const result = {};
  const lines = text.split('\n');
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Match "Key: Value" or "Key = Value" or "Key - Value"
    const match = trimmed.match(/^([a-zA-ZÀ-ỹ0-9\s()]+)[:=]\s*(.+)$/i) || 
                  trimmed.match(/^([a-zA-ZÀ-ỹ0-9\s()]+)\s*[-—–]\s*(.+)$/i);
    
    if (match) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      
      // Map label to standard key
      const standardKey = LABEL_MAP[key] || key;
      result[standardKey] = value;
    }
  }
  
  // Fallback: try to extract patterns from the full text
  extractPatterns(text, result);
  
  return result;
}

/**
 * Parse structured text (CSV-like)
 */
function parseStructuredText(text) {
  const result = {};
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  
  // First line as headers
  if (lines.length >= 2) {
    const headers = lines[0].split(/[,|;]/).map(h => h.trim().toLowerCase());
    const values = lines[1].split(/[,|;]/).map(v => v.trim());
    
    for (let i = 0; i < headers.length; i++) {
      const key = LABEL_MAP[headers[i]] || headers[i];
      result[key] = values[i] || '';
    }
  }
  
  extractPatterns(text, result);
  return result;
}

/**
 * Parse free-form text using regex patterns
 */
function parseFreeFormText(text) {
  const result = {};
  const cleaned = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Extract phone
  const phones = [...cleaned.matchAll(PATTERNS.phone)];
  if (phones.length > 0) {
    result.phone = phones[0][1].trim();
  }

  // Extract email
  const emails = [...cleaned.matchAll(PATTERNS.email)];
  if (emails.length > 0) {
    result.email = emails[0][1].trim();
  }

  // Extract card number (16 digits, possibly with separators)
  const cards = [...cleaned.matchAll(PATTERNS.cardNumber)];
  if (cards.length > 0) {
    result.cardNumber = cards[0][1].replace(/[\s-]/g, '');
  }

  // Extract expiry
  const expiries = [...cleaned.matchAll(PATTERNS.cardExpiry)];
  if (expiries.length > 0) {
    result.cardExpiry = expiries[0][1];
  }

  // Extract CVV
  const cvvMatch = PATTERNS.cvv.exec(cleaned);
  if (cvvMatch) result.cardCVV = cvvMatch[1];

  // Extract zip
  const zipMatch = PATTERNS.zipCode.exec(cleaned);
  if (zipMatch) result.zipCode = zipMatch[1];

  // Extract city
  const cityMatch = ADDRESS_PATTERNS.city.exec(cleaned);
  if (cityMatch) result.city = normalizeCity(cityMatch[1]);

  // Extract district
  const districtMatch = ADDRESS_PATTERNS.district.exec(cleaned);
  if (districtMatch) result.district = `Quận ${districtMatch[2].trim()}`;

  // Extract ward
  const wardMatch = ADDRESS_PATTERNS.ward.exec(cleaned);
  if (wardMatch) result.ward = `Phường ${wardMatch[2].trim()}`;

  // Extract street
  const streetMatch = ADDRESS_PATTERNS.street.exec(cleaned);
  if (streetMatch) result.street = (streetMatch[1] || streetMatch[2] || '').trim();

  // Try to extract name (everything before the first number/phone/email)
  // Remove known extracted parts
  let nameText = cleaned;
  const extractedValues = [
    result.phone, result.email, result.cardNumber, result.cardExpiry,
    result.cardCVV, result.zipCode
  ].filter(Boolean);
  
  for (const val of extractedValues) {
    nameText = nameText.replace(val, '');
  }
  
  // Extract name as the remaining text before any punctuation
  const nameMatch = nameText.match(/^([A-ZÀ-Ỹ][a-zà-ỹ]*(?:\s+[A-ZÀ-Ỹ][a-zà-ỹ]*)+)/);
  if (nameMatch) {
    result.fullName = nameMatch[1].trim();
  }

  // Fallback: try to extract street as anything between name/city and before numbers
  if (!result.street) {
    const addressPart = cleaned.replace(result.fullName || '', '')
      .replace(result.city || '', '')
      .replace(result.phone || '', '')
      .replace(result.email || '', '')
      .replace(result.cardNumber || '', '')
      .trim();
    
    // Take first meaningful part as street
    const streetGuess = addressPart.match(/^(.{5,50}?)(?:,|\.|\s{2,}|$)/);
    if (streetGuess && streetGuess[1].trim().length > 3) {
      result.street = streetGuess[1].trim();
    }
  }

  return result;
}

/**
 * Extract common patterns from any text
 */
function extractPatterns(text, result) {
  // Phone not yet found
  if (!result.phone) {
    const pm = text.match(PATTERNS.phone);
    if (pm) result.phone = pm[0];
  }

  // Email not yet found
  if (!result.email) {
    const em = text.match(PATTERNS.email);
    if (em) result.email = em[0];
  }

  // Card number not yet found
  if (!result.cardNumber) {
    const cm = text.match(PATTERNS.cardNumber);
    if (cm) result.cardNumber = cm[0].replace(/[\s-]/g, '');
  }

  // Expiry not yet found
  if (!result.cardExpiry) {
    const xm = text.match(PATTERNS.cardExpiry);
    if (xm) result.cardExpiry = xm[0];
  }

  // CVV
  if (!result.cardCVV) {
    const cvm = PATTERNS.cvv.exec(text);
    if (cvm) result.cardCVV = cvm[1];
  }

  // City
  if (!result.city) {
    const cim = text.match(ADDRESS_PATTERNS.city);
    if (cim) result.city = normalizeCity(cim[1]);
  }

  // Quantity
  if (!result.quantity) {
    const qm = PATTERNS.quantity.exec(text);
    if (qm) result.quantity = qm[1];
  }
}

/**
 * Build the final order-data.json structure from parsed data
 */
function buildOrderData(parsed) {
  const orderData = {
    checkout: {
      url: parsed.url || 'https://your-shop.com/checkout',
      successURLContains: ['success', 'thank', 'complete', 'cam-on', 'thanh-cong', 'don-hang'],
      successTextContains: ['cảm ơn', 'thành công', 'đơn hàng', 'đã đặt', 'đã thanh toán', 'thank you', 'order placed']
    },
    customer: {},
    shipping: {},
    payment: {}
  };

  // Map parsed fields to sections
  const customerFields = ['fullName', 'firstName', 'lastName', 'email', 'phone', 'note'];
  const shippingFields = ['street', 'ward', 'district', 'city', 'province', 'country', 'zipCode'];
  const paymentFields = ['cardNumber', 'cardHolderName', 'cardExpiry', 'cardExpiryMonth', 'cardExpiryYear', 'cardCVV'];

  for (const field of customerFields) {
    if (parsed[field]) orderData.customer[field] = parsed[field];
  }

  for (const field of shippingFields) {
    if (parsed[field]) orderData.shipping[field] = parsed[field];
  }

  for (const field of paymentFields) {
    if (parsed[field]) orderData.payment[field] = parsed[field];
  }

  // Ensure minimum defaults
  if (!orderData.customer.fullName && (orderData.customer.firstName || orderData.customer.lastName)) {
    orderData.customer.fullName = `${orderData.customer.lastName || ''} ${orderData.customer.firstName || ''}`.trim();
  }

  return orderData;
}

/**
 * Normalize city names
 */
function normalizeCity(city) {
  const lower = city.toLowerCase().trim();
  const map = {
    'hà nội': 'Hà Nội',
    'tp. hồ chí minh': 'TP. Hồ Chí Minh',
    'tp.hcm': 'TP. Hồ Chí Minh',
    'tphcm': 'TP. Hồ Chí Minh',
    'tp hcm': 'TP. Hồ Chí Minh',
    'hồ chí minh': 'TP. Hồ Chí Minh',
    'hcm': 'TP. Hồ Chí Minh',
    'saigon': 'TP. Hồ Chí Minh',
    'sài gòn': 'TP. Hồ Chí Minh',
    'đà nẵng': 'Đà Nẵng',
    'hải phòng': 'Hải Phòng',
    'cần thơ': 'Cần Thơ',
    'huế': 'Huế',
    'nha trang': 'Nha Trang',
    'đà lạt': 'Đà Lạt',
    'vũng tàu': 'Vũng Tàu',
  };
  return map[lower] || city.charAt(0).toUpperCase() + city.slice(1);
}

module.exports = { convertRawToOrderData };
