/**
 * Test script for the new user settings API endpoints
 * Run with: node test-settings-api.js
 */

const fetch = require('node-fetch');

const API_BASE_URL = 'http://localhost:5000/api';

// You'll need to replace this with a valid JWT token from your system
const TEST_TOKEN = 'your-jwt-token-here';

async function testSettingsAPI() {
  console.log('🧪 Testing User Settings API...\n');

  try {
    // Test 1: Get user settings
    console.log('1. Testing GET /api/users/settings');
    const getResponse = await fetch(`${API_BASE_URL}/users/settings`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (getResponse.ok) {
      const settings = await getResponse.json();
      console.log('✅ Successfully fetched user settings:');
      console.log(JSON.stringify(settings, null, 2));
    } else {
      console.log('❌ Failed to fetch settings:', getResponse.status, await getResponse.text());
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 2: Update user settings
    console.log('2. Testing PUT /api/users/settings');
    const updateData = {
      timezone: 'Europe/London',
      dateFormat: 'DD/MM/YYYY',
      timeFormat: '24h',
      currency: 'GBP'
    };

    const updateResponse = await fetch(`${API_BASE_URL}/users/settings`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });

    if (updateResponse.ok) {
      const result = await updateResponse.json();
      console.log('✅ Successfully updated user settings:');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('❌ Failed to update settings:', updateResponse.status, await updateResponse.text());
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 3: Verify settings were updated
    console.log('3. Testing GET /api/users/settings (verification)');
    const verifyResponse = await fetch(`${API_BASE_URL}/users/settings`, {
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    if (verifyResponse.ok) {
      const updatedSettings = await verifyResponse.json();
      console.log('✅ Settings after update:');
      console.log(JSON.stringify(updatedSettings, null, 2));
    } else {
      console.log('❌ Failed to verify settings:', verifyResponse.status, await verifyResponse.text());
    }

    console.log('\n' + '='.repeat(50) + '\n');

    // Test 4: Test invalid data
    console.log('4. Testing PUT /api/users/settings with invalid data');
    const invalidData = {
      timezone: 'Invalid/Timezone',
      dateFormat: 'Invalid/Format',
      timeFormat: 'invalid',
      currency: 'INVALID'
    };

    const invalidResponse = await fetch(`${API_BASE_URL}/users/settings`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(invalidData)
    });

    if (!invalidResponse.ok) {
      console.log('✅ Correctly rejected invalid data:', invalidResponse.status, await invalidResponse.text());
    } else {
      console.log('❌ Should have rejected invalid data');
    }

  } catch (error) {
    console.error('❌ Test failed with error:', error.message);
  }
}

// Test validation functions
function testValidation() {
  console.log('\n🧪 Testing validation functions...\n');

  const validTimezones = [
    'UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles',
    'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Rome', 'Europe/Madrid',
    'Asia/Tokyo', 'Asia/Shanghai', 'Asia/Hong_Kong', 'Asia/Singapore', 'Asia/Kolkata',
    'Australia/Sydney', 'Australia/Melbourne', 'Australia/Perth', 'Australia/Adelaide',
    'Pacific/Auckland', 'Pacific/Fiji'
  ];

  const validDateFormats = ['MM/DD/YYYY', 'DD/MM/YYYY', 'YYYY-MM-DD'];
  const validTimeFormats = ['12h', '24h'];
  const validCurrencies = ['USD', 'EUR', 'GBP', 'AUD', 'CAD', 'JPY', 'CNY', 'INR'];

  console.log('Valid timezones:', validTimezones.length);
  console.log('Valid date formats:', validDateFormats);
  console.log('Valid time formats:', validTimeFormats);
  console.log('Valid currencies:', validCurrencies);
}

// Run tests
if (require.main === module) {
  console.log('🚀 Starting User Settings API Tests\n');
  
  if (TEST_TOKEN === 'your-jwt-token-here') {
    console.log('⚠️  Please update TEST_TOKEN with a valid JWT token before running tests');
    console.log('   You can get a token by logging into the application and checking localStorage');
    testValidation();
  } else {
    testSettingsAPI();
    testValidation();
  }
}

module.exports = { testSettingsAPI, testValidation };
