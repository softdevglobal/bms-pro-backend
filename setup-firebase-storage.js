// Script to help set up Firebase Storage
const admin = require('./firebaseAdmin');

async function setupFirebaseStorage() {
  try {
    console.log('🚀 Setting up Firebase Storage...');
    
    // Get the specific bucket
    const bucket = admin.storage().bucket('bms-pro-e3125.firebasestorage.app');
    console.log('📦 Bucket name:', bucket.name);
    
    // Check if bucket exists
    const [exists] = await bucket.exists();
    console.log('✅ Bucket exists:', exists);
    
    if (!exists) {
      console.log('❌ Bucket does not exist!');
      console.log('');
      console.log('🔧 To fix this, follow these steps:');
      console.log('1. Go to https://console.firebase.google.com/');
      console.log('2. Select your project: bms-pro-e3125');
      console.log('3. Click "Storage" in the left sidebar');
      console.log('4. Click "Get Started"');
      console.log('5. Choose "Start in test mode"');
      console.log('6. Select a location (choose one close to your users)');
      console.log('7. Click "Done"');
      console.log('');
      console.log('🔄 After setting up, run this script again to verify.');
      return;
    }
    
    // Test permissions by trying to list files
    const [files] = await bucket.getFiles({ maxResults: 1 });
    console.log('🔐 Can list files:', true);
    console.log('📁 Files found:', files.length);
    
    // Test upload permissions by creating a test file
    const testFileName = `test-${Date.now()}.txt`;
    const testFile = bucket.file(testFileName);
    
    await testFile.save('Hello Firebase Storage!', {
      metadata: {
        contentType: 'text/plain'
      }
    });
    console.log('📤 Can upload files:', true);
    
    // Clean up test file
    await testFile.delete();
    console.log('🗑️ Can delete files:', true);
    
    console.log('');
    console.log('🎉 Firebase Storage is properly configured!');
    console.log('✅ Profile picture uploads should work now.');
    
  } catch (error) {
    console.error('❌ Error setting up Firebase Storage:', error.message);
    
    if (error.code === 404) {
      console.log('');
      console.log('🔧 The bucket does not exist. Please set it up in Firebase Console:');
      console.log('1. Go to https://console.firebase.google.com/');
      console.log('2. Select your project: bms-pro-e3125');
      console.log('3. Click "Storage" in the left sidebar');
      console.log('4. Click "Get Started"');
      console.log('5. Follow the setup wizard');
    } else if (error.code === 403) {
      console.log('');
      console.log('🔐 Permission denied. Your service account needs Storage Admin permissions:');
      console.log('1. Go to https://console.cloud.google.com/');
      console.log('2. Select your project: bms-pro-e3125');
      console.log('3. Go to IAM & Admin > IAM');
      console.log('4. Find your service account (firebase-adminsdk-xxxxx@bms-pro-e3125.iam.gserviceaccount.com)');
      console.log('5. Click Edit and add "Storage Admin" role');
    } else {
      console.log('');
      console.log('🔧 Unknown error. Check your Firebase configuration.');
    }
  }
}

// Run the setup
setupFirebaseStorage();
