# Profile Picture Feature Setup Guide

This guide explains how to set up the profile picture feature that has been added to the BMS Pro application.

## Backend Dependencies

The following npm packages need to be installed in the backend:

```bash
cd "D:\Softdev Global\bms-pro\bmspro-backend"
npm install multer @google-cloud/storage
```

### Dependencies Explanation:

- **multer**: Middleware for handling multipart/form-data, which is primarily used for uploading files
- **@google-cloud/storage**: Official Google Cloud Storage client library for Node.js (used with Firebase Storage)

## Features Implemented

### Backend Features:

1. **Profile Picture Upload Endpoint** (`POST /api/users/upload-profile-picture`)
   - Accepts image files (JPG, PNG, GIF)
   - 5MB file size limit
   - Stores files in Firebase Storage under `profile-pictures/` folder
   - Updates user document with profile picture URL
   - Includes audit logging

2. **Profile Picture Delete Endpoint** (`DELETE /api/users/delete-profile-picture`)
   - Removes profile picture from Firebase Storage
   - Updates user document to remove profile picture URL
   - Includes audit logging

3. **User Model Updates**
   - Added `profilePicture` field to user documents
   - Updated user creation and profile endpoints to include profile picture data

4. **Audit Service Updates**
   - Added `logProfilePictureUpdated()` function
   - Added `logProfilePictureDeleted()` function

### Frontend Features:

1. **ProfilePictureUpload Component**
   - Drag and drop file upload
   - Image preview
   - File validation (type and size)
   - Upload and delete functionality
   - Multiple size options (sm, md, lg, xl)

2. **ProfilePicture Component**
   - Displays profile pictures with fallback
   - Multiple size options
   - Shows user initials when no picture is available

3. **User Creation Form Updates**
   - Added profile picture upload section for hall_owner creation
   - Optional profile picture during user creation

4. **Settings Page Updates**
   - Added profile picture management section in Settings > General
   - Upload, change, and delete profile picture functionality
   - Only available for hall_owner users

5. **Users Table Updates**
   - Added profile picture column to users table
   - Shows profile pictures in the users list

## File Structure

### Backend Files Modified:
- `routes/users.js` - Added upload/delete endpoints and user model updates
- `services/auditService.js` - Added profile picture audit functions

### Frontend Files Created:
- `src/components/ui/ProfilePictureUpload.jsx` - Upload component
- `src/components/ui/ProfilePicture.jsx` - Display component
- `src/services/profilePictureService.js` - API service functions

### Frontend Files Modified:
- `src/pages/Users.jsx` - Added profile picture to user creation and table
- `src/pages/SettingsGeneral.jsx` - Added profile picture management section

## Usage

### For Super Admins:
1. When creating a new hall_owner, you can optionally upload a profile picture
2. Profile pictures are displayed in the users table

### For Hall Owners:
1. Go to Settings > General
2. Scroll to the "Profile Picture" section
3. Upload, change, or delete your profile picture
4. Changes are saved immediately

## Storage Details

- **Storage Location**: Firebase Storage bucket `bms-pro-e3125.appspot.com`
- **Folder Structure**: `profile-pictures/{userId}-{timestamp}.{extension}`
- **File Access**: Files are made publicly accessible via Google Cloud Storage URLs
- **File Limits**: 5MB maximum file size, images only (JPG, PNG, GIF)

## Security Considerations

- File type validation on both frontend and backend
- File size limits enforced
- User authentication required for all operations
- Audit logging for all profile picture changes
- Files are stored with user-specific naming to prevent conflicts

## Testing

To test the feature:

1. Install the backend dependencies
2. Start the backend server
3. Start the frontend application
4. Log in as a super_admin and create a new hall_owner with a profile picture
5. Log in as a hall_owner and test the profile picture management in settings
6. Verify profile pictures appear in the users table

## Troubleshooting

### Common Issues:

1. **Upload fails**: Check that multer and @google-cloud/storage are installed
2. **Permission errors**: Verify Firebase service account has Storage Admin permissions
3. **File not displaying**: Check that files are being made public in Firebase Storage
4. **Large file uploads**: Ensure file size is under 5MB limit

### Firebase Storage Configuration:

Ensure your Firebase project has Storage enabled and the service account key has the necessary permissions:
- Storage Object Admin
- Storage Object Creator
- Storage Object Viewer
