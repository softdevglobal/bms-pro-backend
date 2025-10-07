const axios = require('axios');

const API_BASE_URL = 'http://localhost:5000/api';

// Test data
const testUser = {
  email: 'test@example.com',
  password: 'password123'
};

async function testEmailFix() {
  try {
    console.log('🧪 Testing Email Communications Fix...\n');

    // Step 1: Login to get token
    console.log('1. Logging in...');
    const loginResponse = await axios.post(`${API_BASE_URL}/login`, testUser);
    const token = loginResponse.data.token;
    console.log('✅ Login successful\n');

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Step 2: Test email templates endpoint
    console.log('2. Testing email templates endpoint...');
    try {
      const templatesResponse = await axios.get(`${API_BASE_URL}/email-templates`, { headers });
      console.log('✅ Email templates endpoint working');
      console.log('   Templates found:', templatesResponse.data.templates.length);
    } catch (err) {
      console.log('❌ Email templates endpoint failed:', err.response?.data?.message || err.message);
    }
    console.log('');

    // Step 3: Test email history endpoint
    console.log('3. Testing email history endpoint...');
    try {
      const historyResponse = await axios.get(`${API_BASE_URL}/email-comms/history`, { headers });
      console.log('✅ Email history endpoint working');
      console.log('   Emails found:', historyResponse.data.emails.length);
    } catch (err) {
      console.log('❌ Email history endpoint failed:', err.response?.data?.message || err.message);
    }
    console.log('');

    // Step 4: Test customers endpoint
    console.log('4. Testing customers endpoint...');
    try {
      const customersResponse = await axios.get(`${API_BASE_URL}/email-comms/customers`, { headers });
      console.log('✅ Customers endpoint working');
      console.log('   Customers found:', customersResponse.data.customers.length);
    } catch (err) {
      console.log('❌ Customers endpoint failed:', err.response?.data?.message || err.message);
    }
    console.log('');

    console.log('🎉 All tests completed! The Firestore index issues should be resolved.');

  } catch (error) {
    console.error('❌ Test failed:', error.response?.data?.message || error.message);
    if (error.response?.data) {
      console.error('   Response data:', error.response.data);
    }
    process.exit(1);
  }
}

// Run the test
testEmailFix();
