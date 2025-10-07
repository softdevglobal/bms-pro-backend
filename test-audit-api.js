const axios = require('axios');

const API_BASE_URL = 'http://localhost:5000/api';

// Test audit API endpoints
async function testAuditAPI() {
  console.log('Testing Audit API Endpoints...\n');

  try {
    // First, get a token by logging in (you'll need to replace with actual credentials)
    console.log('1. Getting authentication token...');
    
    // Note: Replace these with actual test credentials
    const loginResponse = await axios.post(`${API_BASE_URL}/login`, {
      email: 'admin@example.com', // Replace with actual admin email
      password: 'password123'     // Replace with actual password
    });

    const token = loginResponse.data.token;
    const role = loginResponse.data.role;
    
    console.log(`✅ Login successful. Role: ${role}`);
    console.log(`Token: ${token.substring(0, 20)}...\n`);

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    };

    // Test 2: Get audit logs
    console.log('2. Testing GET /api/audit - Get audit logs...');
    const auditLogsResponse = await axios.get(`${API_BASE_URL}/audit`, { headers });
    console.log(`✅ Retrieved ${auditLogsResponse.data.auditLogs.length} audit logs`);
    console.log(`Total logs: ${auditLogsResponse.data.pagination.total}\n`);

    // Test 3: Get audit actions
    console.log('3. Testing GET /api/audit/actions - Get available actions...');
    const actionsResponse = await axios.get(`${API_BASE_URL}/audit/actions`, { headers });
    console.log(`✅ Retrieved ${actionsResponse.data.actions.length} available actions`);
    console.log(`Actions: ${actionsResponse.data.actions.slice(0, 5).join(', ')}...\n`);

    // Test 4: Get audit target types
    console.log('4. Testing GET /api/audit/target-types - Get target types...');
    const targetTypesResponse = await axios.get(`${API_BASE_URL}/audit/target-types`, { headers });
    console.log(`✅ Retrieved ${targetTypesResponse.data.targetTypes.length} target types`);
    console.log(`Target types: ${targetTypesResponse.data.targetTypes.join(', ')}\n`);

    // Test 5: Get audit stats
    console.log('5. Testing GET /api/audit/stats - Get audit statistics...');
    const statsResponse = await axios.get(`${API_BASE_URL}/audit/stats`, { headers });
    console.log(`✅ Retrieved audit statistics`);
    console.log(`Total logs: ${statsResponse.data.totalLogs}`);
    console.log(`Active users: ${Object.keys(statsResponse.data.usersCount).length}`);
    console.log(`Action types: ${Object.keys(statsResponse.data.actionsCount).length}\n`);

    // Test 6: Test filtering
    console.log('6. Testing audit logs with filters...');
    const filteredResponse = await axios.get(`${API_BASE_URL}/audit?action=user_login&limit=10`, { headers });
    console.log(`✅ Retrieved ${filteredResponse.data.auditLogs.length} filtered logs\n`);

    console.log('🎉 All audit API tests completed successfully!');
    console.log('\nSample audit log entry:');
    if (auditLogsResponse.data.auditLogs.length > 0) {
      const sampleLog = auditLogsResponse.data.auditLogs[0];
      console.log(JSON.stringify(sampleLog, null, 2));
    }

  } catch (error) {
    console.error('❌ Error during audit API tests:', error.response?.data || error.message);
    
    if (error.response?.status === 401) {
      console.log('\n💡 Make sure you have valid test credentials in the script.');
      console.log('   Update the email and password in the login section.');
    }
  }
}

// Run the tests
testAuditAPI().then(() => {
  console.log('\nAPI tests completed. Exiting...');
  process.exit(0);
}).catch(error => {
  console.error('API tests failed:', error);
  process.exit(1);
});
