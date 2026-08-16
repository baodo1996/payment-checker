// Fake payment test data for automated checkout testing
// ALL DATA IS FAKE - for testing purposes only

const fakeCards = {
  visa: {
    number: '4111111111111111',
    cvv: '123',
    expiry: '12/28',
    name: 'NGUYEN VAN A'
  },
  mastercard: {
    number: '5555555555554444',
    cvv: '456',
    expiry: '06/27',
    name: 'TRAN THI B'
  },
  amex: {
    number: '378282246310005',
    cvv: '7890',
    expiry: '03/29',
    name: 'LE VAN C'
  },
  jcb: {
    number: '3530111333300000',
    cvv: '321',
    expiry: '09/26',
    name: 'PHAM THI D'
  }
};

const fakeAddresses = [
  {
    street: '123 Nguyễn Huệ',
    ward: 'Phường Bến Nghé',
    district: 'Quận 1',
    city: 'TP. Hồ Chí Minh',
    phone: '0901234567',
    email: 'test1@example.com'
  },
  {
    street: '456 Lê Lợi',
    ward: 'Phường Lê Lợi',
    district: 'Quận Ngô Quyền',
    city: 'Hải Phòng',
    phone: '0912345678',
    email: 'test2@example.com'
  },
  {
    street: '789 Trần Phú',
    ward: 'Phường Văn Quán',
    district: 'Quận Hà Đông',
    city: 'Hà Nội',
    phone: '0923456789',
    email: 'test3@example.com'
  }
];

const fakeOrderInfo = {
  productName: 'Sản phẩm test - Kiểm tra thanh toán',
  quantity: 1,
  amount: 50000,
  currency: 'VND',
  orderNote: 'Đơn hàng test tự động - vui lòng bỏ qua'
};

function getRandomAddress() {
  return fakeAddresses[Math.floor(Math.random() * fakeAddresses.length)];
}

function getCardByType(type = 'visa') {
  return fakeCards[type] || fakeCards.visa;
}

module.exports = {
  fakeCards,
  fakeAddresses,
  fakeOrderInfo,
  getRandomAddress,
  getCardByType
};
