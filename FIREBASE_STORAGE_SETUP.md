# Firebase Storage Setup Guide

The profile picture feature requires Firebase Storage to be set up. The error indicates that the storage bucket doesn't exist yet.

## Quick Setup Steps

### 1. Enable Firebase Storage

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project: `bms-pro-e3125`
3. In the left sidebar, click on **Storage**
4. Click **Get Started**
5. Choose **Start in test mode** (for development) or **Start in production mode** (for production)
6. Select a location for your storage bucket (choose one close to your users)
7. Click **Done**

### 2. Configure Storage Rules (for test mode)

If you chose test mode, your rules will be:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /{allPaths=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

For production, you might want more restrictive rules:
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /profile-pictures/{userId}/{fileName} {
      allow read: if true; // Public read for profile pictures
      allow write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

### 3. Verify Service Account Permissions

Your service account needs Storage Admin permissions:

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Select your project: `bms-pro-e3125`
3. Go to **IAM & Admin** > **IAM**
4. Find your service account (usually `firebase-adminsdk-xxxxx@bms-pro-e3125.iam.gserviceaccount.com`)
5. Click **Edit** (pencil icon)
6. Add these roles:
   - **Storage Admin**
   - **Storage Object Admin**
   - **Storage Object Creator**
   - **Storage Object Viewer**

### 4. Test the Setup

After setting up Firebase Storage, test it by calling the test endpoint:

```bash
GET /api/users/test-storage
```

This will verify that:
- The bucket exists
- Your service account has proper permissions
- The connection is working

### 5. Alternative: Use Default Bucket

If you want to use the default bucket name, you can modify the code to not specify a bucket name:

```javascript
// This will use the default bucket from your Firebase config
const bucket = admin.storage().bucket();
```

## Troubleshooting

### Common Issues:

1. **Bucket doesn't exist**: Follow steps 1-2 above
2. **Permission denied**: Follow step 3 above
3. **Wrong bucket name**: Check your Firebase project ID and bucket name
4. **Service account key issues**: Ensure your `serviceAccountKey.json` is up to date

### Bucket Name Format:

Firebase Storage bucket names typically follow this pattern:
- `{project-id}.appspot.com` (default)
- `gs://{project-id}.appspot.com`

For your project, the bucket should be:
- `bms-pro-e3125.appspot.com`

### Testing Commands:

```bash
# Test if bucket exists
curl -X GET "http://localhost:5000/api/users/test-storage" \
  -H "Authorization: Bearer YOUR_TOKEN"

# Test file upload
curl -X POST "http://localhost:5000/api/users/upload-profile-picture" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -F "profilePicture=@test-image.jpg"
```

## Next Steps

1. Complete the Firebase Storage setup above
2. Test the storage connectivity
3. Try uploading a profile picture again
4. The feature should work once the bucket is properly configured

If you continue to have issues, check the backend console logs for more detailed error messages.
