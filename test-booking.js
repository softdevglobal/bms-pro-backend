// Simple test script to verify booking API
const fetch = require('node-fetch');

const testBooking = async () => {
  try {
    console.log('Testing booking API...');
    
    const bookingData = {
      customerName: "John Doe",
      customerEmail: "john.doe@example.com",
      customerPhone: "+61400123456",
      eventType: "wedding",
      selectedHall: "main-hall-id", // This would need to be a real resource ID
      bookingDate: "2024-02-15",
      startTime: "10:00",
      endTime: "18:00",
      additionalDescription: "Wedding ceremony and reception",
      hallOwnerId: "bLRLXrfr5pRBVcUntxUFlvXewaw1"
    };

    const response = await fetch('http://localhost:5000/api/bookings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(bookingData)
    });

    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Booking created successfully:', result);
    } else {
      console.log('❌ Booking failed:', result);
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
  }
};

// Test resources API
const testResources = async () => {
  try {
    console.log('Testing resources API...');
    
    const response = await fetch('http://localhost:5000/api/resources/public/bLRLXrfr5pRBVcUntxUFlvXewaw1');
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Resources fetched successfully:', result);
    } else {
      console.log('❌ Resources fetch failed:', result);
    }
    
  } catch (error) {
    console.error('❌ Resources test failed:', error.message);
  }
};

// Test pricing API
const testPricing = async () => {
  try {
    console.log('Testing pricing API...');
    
    const response = await fetch('http://localhost:5000/api/pricing/public/bLRLXrfr5pRBVcUntxUFlvXewaw1');
    const result = await response.json();
    
    if (response.ok) {
      console.log('✅ Pricing fetched successfully:', result);
    } else {
      console.log('❌ Pricing fetch failed:', result);
    }
    
  } catch (error) {
    console.error('❌ Pricing test failed:', error.message);
  }
};

// Run tests
const runTests = async () => {
  console.log('🚀 Starting API tests...\n');
  
  await testResources();
  console.log('');
  
  await testPricing();
  console.log('');
  
  await testBooking();
  console.log('\n✅ All tests completed!');
};

runTests();
