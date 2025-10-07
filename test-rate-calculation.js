// Test rate calculation functionality
const { calculateResourceRate } = require('../src/services/quotationService');

// Mock pricing data
const mockPricingData = [
  {
    resourceId: 'resource1',
    resourceName: 'Main Hall',
    rateType: 'hourly',
    weekdayRate: 50.00,
    weekendRate: 75.00
  },
  {
    resourceId: 'resource2',
    resourceName: 'Room 1',
    rateType: 'daily',
    weekdayRate: 200.00,
    weekendRate: 300.00
  }
];

console.log('🧪 Testing Rate Calculation...\n');

// Test 1: Hourly rate on weekday
console.log('1. Testing hourly rate on weekday:');
const weekdayHourlyRate = calculateResourceRate(
  mockPricingData,
  'resource1',
  '2025-02-10', // Monday
  '10:00',
  '14:00' // 4 hours
);
console.log(`   Main Hall, Monday 10:00-14:00 (4 hours): $${weekdayHourlyRate.toFixed(2)}`);
console.log(`   Expected: $200.00 (4 hours × $50/hour)\n`);

// Test 2: Hourly rate on weekend
console.log('2. Testing hourly rate on weekend:');
const weekendHourlyRate = calculateResourceRate(
  mockPricingData,
  'resource1',
  '2025-02-15', // Saturday
  '10:00',
  '14:00' // 4 hours
);
console.log(`   Main Hall, Saturday 10:00-14:00 (4 hours): $${weekendHourlyRate.toFixed(2)}`);
console.log(`   Expected: $300.00 (4 hours × $75/hour)\n`);

// Test 3: Daily rate on weekday
console.log('3. Testing daily rate on weekday:');
const weekdayDailyRate = calculateResourceRate(
  mockPricingData,
  'resource2',
  '2025-02-10', // Monday
  '10:00',
  '18:00'
);
console.log(`   Room 1, Monday (daily rate): $${weekdayDailyRate.toFixed(2)}`);
console.log(`   Expected: $200.00 (daily rate)\n`);

// Test 4: Daily rate on weekend
console.log('4. Testing daily rate on weekend:');
const weekendDailyRate = calculateResourceRate(
  mockPricingData,
  'resource2',
  '2025-02-15', // Saturday
  '10:00',
  '18:00'
);
console.log(`   Room 1, Saturday (daily rate): $${weekendDailyRate.toFixed(2)}`);
console.log(`   Expected: $300.00 (weekend daily rate)\n`);

// Test 5: Resource not found
console.log('5. Testing resource not found:');
const notFoundRate = calculateResourceRate(
  mockPricingData,
  'nonexistent',
  '2025-02-10',
  '10:00',
  '14:00'
);
console.log(`   Nonexistent resource: $${notFoundRate.toFixed(2)}`);
console.log(`   Expected: $0.00 (no pricing found)\n`);

console.log('🎉 Rate calculation tests completed!');
