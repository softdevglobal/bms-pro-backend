const express = require('express');
const admin = require('./firebaseAdmin');

// Test script to verify reports API endpoints
async function testReportsAPI() {
  console.log('🧪 Testing Reports API...\n');
  
  try {
    // Test 1: Check if Firebase Admin is working
    console.log('1. Testing Firebase Admin connection...');
    const testUser = await admin.auth().listUsers(1);
    console.log('✅ Firebase Admin connection successful');
    
    // Test 2: Check if we can access Firestore
    console.log('\n2. Testing Firestore connection...');
    const usersSnapshot = await admin.firestore().collection('users').limit(1).get();
    console.log(`✅ Firestore connection successful (${usersSnapshot.docs.length} users found)`);
    
    // Test 3: Check if we can access bookings
    console.log('\n3. Testing Bookings collection...');
    const bookingsSnapshot = await admin.firestore().collection('bookings').limit(1).get();
    console.log(`✅ Bookings collection accessible (${bookingsSnapshot.docs.length} bookings found)`);
    
    // Test 4: Test reports logic
    console.log('\n4. Testing reports data aggregation...');
    
    // Get a sample hall owner
    const hallOwners = await admin.firestore()
      .collection('users')
      .where('role', '==', 'hall_owner')
      .limit(1)
      .get();
    
    if (hallOwners.docs.length === 0) {
      console.log('⚠️  No hall owners found in database');
      console.log('   This might be why reports show zero data');
    } else {
      const hallOwnerId = hallOwners.docs[0].id;
      console.log(`✅ Found hall owner: ${hallOwnerId}`);
      
      // Get bookings for this hall owner
      const userBookings = await admin.firestore()
        .collection('bookings')
        .where('hallOwnerId', '==', hallOwnerId)
        .get();
      
      console.log(`✅ Found ${userBookings.docs.length} bookings for this hall owner`);
      
      if (userBookings.docs.length === 0) {
        console.log('⚠️  No bookings found for this hall owner');
        console.log('   This explains why reports show zero data');
      } else {
        // Show sample booking data
        const sampleBooking = userBookings.docs[0].data();
        console.log('📊 Sample booking data:', {
          customerName: sampleBooking.customerName,
          eventType: sampleBooking.eventType,
          bookingDate: sampleBooking.bookingDate,
          status: sampleBooking.status,
          calculatedPrice: sampleBooking.calculatedPrice
        });
      }
    }
    
    console.log('\n🎉 Reports API test completed successfully!');
    
  } catch (error) {
    console.error('❌ Reports API test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testReportsAPI().then(() => {
  console.log('\n✨ Test script finished');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test script crashed:', error);
  process.exit(1);
});
