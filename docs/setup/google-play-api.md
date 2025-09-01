# Google Play API Setup Guide

This comprehensive guide walks you through setting up Google Play Console API access for the Matrix Google Play Bridge. This integration allows the bridge to fetch reviews and post replies on behalf of your organization.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Google Cloud Platform Setup](#google-cloud-platform-setup)
- [Google Play Console Configuration](#google-play-console-configuration)
- [Service Account Setup](#service-account-setup)
- [API Testing and Verification](#api-testing-and-verification)
- [Security Best Practices](#security-best-practices)
- [Troubleshooting](#troubleshooting)

## Prerequisites

Before starting, ensure you have:

1. **Google Play Console Account**: Active account with published Android applications
2. **Google Cloud Platform Account**: Access to create projects and service accounts
3. **Admin Access**: Administrative permissions for both Google Play Console and Google Cloud Platform
4. **Published Apps**: At least one published app on Google Play Store (the API only works with published apps)

## Google Cloud Platform Setup

### Step 1: Create or Select a Google Cloud Project

1. **Navigate to Google Cloud Console**
   - Go to [Google Cloud Console](https://console.cloud.google.com/)
   - Sign in with your Google account

2. **Create a New Project** (or select existing)
   - Click the project dropdown in the top navigation
   - Click "New Project"
   - Enter project details:
     - **Project Name**: `Matrix GooglePlay Bridge` (or your preferred name)
     - **Project ID**: `matrix-googleplay-bridge-XXXXX` (auto-generated, note this ID)
     - **Organization**: Select your organization if applicable
   - Click "Create"

3. **Select the Project**
   - Ensure your new project is selected in the project dropdown
   - The project ID should be visible in the top navigation bar

### Step 2: Enable Required APIs

1. **Navigate to APIs & Services**
   - In the left sidebar, click "APIs & Services" → "Library"
   - Or visit: [https://console.cloud.google.com/apis/library](https://console.cloud.google.com/apis/library)

2. **Enable Google Play Android Developer API**
   - Search for "Google Play Android Developer API"
   - Click on the API result
   - Click "Enable" button
   - Wait for the API to be enabled (may take a few minutes)

3. **Verify API is Enabled**
   - Navigate to "APIs & Services" → "Enabled APIs"
   - Confirm "Google Play Android Developer API" appears in the list
   - Note the API endpoint: `https://androidpublisher.googleapis.com/`

### Step 3: Set Up Billing (Required)

⚠️ **Important**: The Google Play Developer API requires a billing account, even though API usage is typically free within generous quotas.

1. **Navigate to Billing**
   - In the left sidebar, click "Billing"
   - Or visit: [https://console.cloud.google.com/billing](https://console.cloud.google.com/billing)

2. **Set Up Billing Account**
   - Click "Link a billing account"
   - Follow the prompts to add a payment method
   - Billing is required but typical API usage is free

3. **Verify Billing Setup**
   - Ensure your project shows "Billing Account: [Your Account]"
   - Check that billing is active and not suspended

## Service Account Setup

### Step 1: Create a Service Account

1. **Navigate to Service Accounts**
   - Go to "IAM & Admin" → "Service Accounts"
   - Or visit: [https://console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)

2. **Create Service Account**
   - Click "Create Service Account"
   - Fill in the details:
     - **Service Account Name**: `matrix-googleplay-bridge`
     - **Service Account ID**: `matrix-googleplay-bridge` (auto-filled)
     - **Description**: `Service account for Matrix Google Play Bridge to access reviews and post replies`
   - Click "Create and Continue"

3. **Skip Role Assignment** (for now)
   - Click "Continue" without assigning roles
   - Click "Done" to finish creation

### Step 2: Generate Service Account Key

1. **Select Your Service Account**
   - Find your newly created service account in the list
   - Click on the service account name

2. **Create Key**
   - Go to the "Keys" tab
   - Click "Add Key" → "Create new key"
   - Select "JSON" format
   - Click "Create"

3. **Download and Secure the Key**
   - The key file will be automatically downloaded
   - **Critical**: Store this file securely - it contains credentials that allow API access
   - Rename the file to something descriptive: `googleplay-service-account-key.json`
   - Move it to a secure location: `/opt/matrix-googleplay-bridge/config/googleplay-service-account-key.json`

4. **Set Proper File Permissions** (Linux/macOS)
   ```bash
   # Restrict access to the key file
   chmod 600 /path/to/googleplay-service-account-key.json
   chown matrix-bridge:matrix-bridge /path/to/googleplay-service-account-key.json
   ```

### Step 3: Note Service Account Details

From the downloaded JSON key file, note these important details:

```json
{
  "type": "service_account",
  "project_id": "your-project-id-here",
  "private_key_id": "key-id-here", 
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "matrix-googleplay-bridge@your-project-id.iam.gserviceaccount.com",
  "client_id": "client-id-here",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

**Important fields for bridge configuration**:
- `client_email`: Service account email address
- `private_key`: Private key for authentication
- `project_id`: Google Cloud project ID

## Google Play Console Configuration

### Step 1: Access Google Play Console

1. **Navigate to Google Play Console**
   - Go to [Google Play Console](https://play.google.com/console/)
   - Sign in with the Google account that has access to your apps
   - Select your developer account if prompted

2. **Verify App Access**
   - Ensure you can see your published applications
   - Note the package names of apps you want to monitor (e.g., `com.yourcompany.yourapp`)

### Step 2: Grant Service Account Access

1. **Navigate to Users and Permissions**
   - In the left sidebar, click "Settings" → "Developer account" → "API access"
   - Or use the direct link provided in the Google Play Console

2. **Link Google Cloud Project**
   - If not already linked, you'll see "Link Google Cloud Project"
   - Click "Link Google Cloud Project"
   - Select your Google Cloud project from the dropdown
   - Confirm the linking

3. **Grant Access to Service Account**
   - Find the "Service accounts" section
   - Locate your service account: `matrix-googleplay-bridge@your-project-id.iam.gserviceaccount.com`
   - Click "Grant Access" next to your service account

4. **Set Permissions**
   - In the permissions dialog, configure access:
     - **Account permissions**: Select "View app information and download bulk reports (read-only)"
     - **App permissions**: 
       - Select "Apply to all current and future apps in this account" OR
       - Select specific apps you want the bridge to monitor
     - **Financial data**: Leave unchecked (not needed for reviews)
   - Click "Apply"

### Step 3: Verify Permissions

1. **Check Service Account Status**
   - In the "API access" page, verify your service account shows "Active" status
   - Confirm the permissions are set correctly
   - Note any warnings or errors

2. **Test Basic Access**
   - The service account should now appear in the list with appropriate permissions
   - Status should show "Active" with green indicator

## API Testing and Verification

### Step 1: Test API Access with curl

Use curl to verify your service account can access the Google Play API:

```bash
# Get an access token
ACCESS_TOKEN=$(curl -s -X POST https://oauth2.googleapis.com/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=$(python3 -c "
import json, jwt, time
with open('/path/to/your/service-account-key.json', 'r') as f:
    key_data = json.load(f)
payload = {
    'iss': key_data['client_email'],
    'scope': 'https://www.googleapis.com/auth/androidpublisher',
    'aud': 'https://oauth2.googleapis.com/token',
    'exp': int(time.time()) + 3600,
    'iat': int(time.time())
}
print(jwt.encode(payload, key_data['private_key'], algorithm='RS256'))
")" | jq -r '.access_token')

# Test API access (replace YOUR_PACKAGE_NAME with your actual app package name)
curl -H "Authorization: Bearer $ACCESS_TOKEN" \
     "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/YOUR_PACKAGE_NAME/reviews"
```

**Expected Success Response**:
```json
{
  "reviews": [
    {
      "reviewId": "review-id-here",
      "authorName": "Reviewer Name",
      "comments": [
        {
          "userComment": {
            "text": "Great app!",
            "lastModified": {...},
            "starRating": 5
          }
        }
      ]
    }
  ],
  "tokenPagination": {...}
}
```

### Step 2: Test with Bridge Configuration

1. **Update Bridge Configuration**
   
   Edit your `config/config.yaml`:
   ```yaml
   googleplay:
     auth:
       keyFile: '/path/to/googleplay-service-account-key.json'
       scopes: ['https://www.googleapis.com/auth/androidpublisher']
     
     applications:
       - packageName: 'com.yourcompany.yourapp'  # Your actual package name
         matrixRoom: '!test:your-domain.com'
         appName: 'Your App Name'
   ```

2. **Test Bridge Connectivity**
   ```bash
   # Start the bridge in test mode
   npm run build
   node dist/app.js --test-googleplay
   
   # Or use the built-in test endpoint
   curl -X POST http://localhost:8080/test/googleplay \
        -H "Content-Type: application/json" \
        -d '{"packageName": "com.yourcompany.yourapp"}'
   ```

3. **Verify Bridge Logs**
   ```bash
   # Check logs for successful API connection
   tail -f logs/bridge.log | grep -i googleplay
   ```

   **Expected log entries**:
   ```
   [INFO] GooglePlay API: Successfully authenticated with service account
   [INFO] GooglePlay API: Connected to package: com.yourcompany.yourapp
   [INFO] GooglePlay API: Found X reviews in the last 7 days
   ```

## Security Best Practices

### Service Account Security

1. **Principle of Least Privilege**
   - Only grant "View app information and download bulk reports" permission
   - Don't grant financial data access unless specifically needed
   - Limit access to specific apps rather than all apps when possible

2. **Key File Security**
   - Store the service account key file in a secure location
   - Set restrictive file permissions (600 on Linux/macOS)
   - Never commit the key file to version control
   - Use environment variables or secure key management in production

3. **Regular Key Rotation**
   - Rotate service account keys every 90 days
   - Delete old keys after verifying new ones work
   - Monitor for any unauthorized usage

### Access Monitoring

1. **Enable Audit Logging**
   - In Google Cloud Console, enable audit logs for the Google Play API
   - Monitor service account usage regularly
   - Set up alerts for unusual activity patterns

2. **API Usage Monitoring**
   - Monitor API quotas and usage in Google Cloud Console
   - Set up billing alerts to detect unexpected usage
   - Review API access logs regularly

### Production Considerations

1. **Environment Variables**
   ```bash
   # Use environment variables instead of hardcoded paths
   export GOOGLE_SERVICE_ACCOUNT_KEY_FILE="/secure/path/to/key.json"
   export GOOGLE_APPLICATION_CREDENTIALS="/secure/path/to/key.json"
   ```

2. **Key Management Systems**
   - Consider using Google Secret Manager for production
   - Use encrypted storage for service account keys
   - Implement automatic key rotation where possible

3. **Network Security**
   - Restrict API access to specific IP addresses if possible
   - Use HTTPS for all API communications
   - Implement proper firewall rules

## Troubleshooting

### Common Setup Issues

1. **"API not enabled" Error**
   ```
   Error: Google Play Android Developer API has not been used in project PROJECT_ID before or it is disabled.
   ```
   **Solution**: 
   - Verify the Google Play Android Developer API is enabled in Google Cloud Console
   - Wait up to 10 minutes after enabling for the API to become active
   - Check billing is set up correctly

2. **"Insufficient Permissions" Error**
   ```
   Error: The current user does not have sufficient permissions for application: com.your.app
   ```
   **Solution**:
   - Verify the service account is granted access in Google Play Console
   - Check that the service account has "View app information" permission
   - Ensure the app is published (API doesn't work with draft apps)

3. **"Invalid Grant" Error**
   ```
   Error: invalid_grant: Invalid JWT: Token must be a short-lived token (60 minutes)
   ```
   **Solution**:
   - Check system clock is synchronized
   - Verify service account key file is not corrupted
   - Ensure the private key format is correct

4. **"Authentication Failed" Error**
   ```
   Error: Failed to authenticate with Google Play API
   ```
   **Solution**:
   - Verify service account key file path is correct
   - Check file permissions (should be readable by bridge user)
   - Confirm the key file contains valid JSON

### Configuration Issues

1. **Wrong Package Name**
   ```
   Error: The app com.wrong.package could not be found.
   ```
   **Solution**:
   - Verify the package name exactly matches your published app
   - Check the package name in Google Play Console app dashboard
   - Ensure the app is published (not in draft)

2. **Missing Reviews**
   ```
   Warning: No reviews found for application com.your.app
   ```
   **Possible causes**:
   - App has no reviews with text comments (rating-only reviews are not accessible)
   - All reviews are older than 7 days (API has 7-day limit)
   - Reviews are in languages not supported by your account region

3. **Rate Limiting Issues**
   ```
   Error: Quota exceeded for quota metric 'Queries per day'
   ```
   **Solution**:
   - Check API usage quotas in Google Cloud Console
   - Increase polling intervals in bridge configuration
   - Request quota increases if needed

### Testing Commands

```bash
# Test service account key validity
python3 -c "
import json
with open('/path/to/service-account-key.json', 'r') as f:
    key = json.load(f)
    print(f'Service Account: {key[\"client_email\"]}')
    print(f'Project ID: {key[\"project_id\"]}')
    print('Key file is valid JSON')
"

# Test Google Play API connectivity
curl -s "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/com.google.android.gms/reviews" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" | jq '.error // "API is accessible"'

# Check bridge Google Play client test
node -e "
const GooglePlayClient = require('./dist/api/GooglePlayClient').GooglePlayClient;
const config = { 
  auth: { 
    keyFile: '/path/to/service-account-key.json',
    scopes: ['https://www.googleapis.com/auth/androidpublisher']
  }
};
const client = new GooglePlayClient(config);
client.testConnection('com.your.app')
  .then(() => console.log('Bridge connection test: SUCCESS'))
  .catch(err => console.error('Bridge connection test: FAILED -', err.message));
"
```

### API Limitations to Consider

1. **7-Day Window**: Reviews API only returns reviews from the last 7 days
2. **Text Comments Only**: Only reviews with text comments are accessible (rating-only reviews are not returned)
3. **Published Apps Only**: API only works with published applications, not drafts or internal testing
4. **Rate Limits**: Default quotas should be sufficient, but monitor usage
5. **Regional Restrictions**: Some reviews may not be accessible based on your developer account region

### Getting Help

If you encounter issues:

1. **Check Google Cloud Console Status Page**: [https://status.cloud.google.com/](https://status.cloud.google.com/)
2. **Review Google Play Console Help**: [https://support.google.com/googleplay/android-developer/](https://support.google.com/googleplay/android-developer/)
3. **Check Bridge Logs**: Enable debug logging and review detailed error messages
4. **Community Support**: 
   - Join Matrix room: `#matrix-googleplay-bridge:your-domain.com`
   - GitHub Issues: [https://github.com/CDLProduction/matrix-googleplay-bridge/issues](https://github.com/CDLProduction/matrix-googleplay-bridge/issues)

## Next Steps

After successful Google Play API setup:

1. **[Configure the Bridge](configuration.md)** with your service account details
2. **[Test the Integration](../troubleshooting.md#testing-google-play-integration)** end-to-end
3. **[Set up Monitoring](../monitoring.md)** to track API usage and health
4. **[Review Security Settings](../security.md)** for production deployment
5. **[Configure Multiple Apps](configuration.md#multi-application-configuration)** if needed

---

Your Google Play API integration is now ready! The bridge can fetch reviews and post replies on behalf of your organization.