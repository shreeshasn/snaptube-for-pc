# NovaTube - BYOK (Bring Your Own Key) Setup Guide

This guide details how to acquire your own API key to bypass NovaTube's local mock mode and resolve real media URLs directly.

NovaTube uses the media resolution API hosted on RapidAPI: `youtube-video-fast-downloader-24-7.p.rapidapi.com`.

---

## [.] Quick Setup Checklist

1. Sign up on [RapidAPI](https://rapidapi.com).
2. Subscribe to the Youtube Video Fast Downloader API (Free/Basic tier is available).
3. Retrieve your private `X-RapidAPI-Key`.
4. Paste the key into NovaTube's client Settings panel.

---

## [.] Step-by-Step Instructions

### Step 1: Create a RapidAPI Account
- Go to [RapidAPI Hub](https://rapidapi.com/hub).
- Click on **Sign Up** at the top right of the navigation header.
- Register using your Google, GitHub, or standard email credentials.

---

### Step 2: Subscribe to the Media Resolution API
- Navigate to the target API endpoint dashboard: [YouTube Video Fast Downloader API](https://rapidapi.com/olawanle97-rapidapi-olawanle97-default/api/youtube-video-fast-downloader-24-7).
- Click on the **Pricing** tab located below the main search navigation block.
- Select the **Basic (Free)** tier by clicking the **Subscribe** button. This tier provides free monthly API queries sufficient for individual testing.

---

### Step 3: Copy Your API Key
- Return to the **Endpoints** tab on the same API documentation page.
- Look at the request builder/code snippet section on the right-hand panel.
- Locate the header parameters object. Copy the token string value associated with the `x-rapidapi-key` key.
- Save this alphanumeric string securely.

---

### Step 4: Configure NovaTube settings

Open the NovaTube app and follow these instructions:

1. Click the **Settings (Gear Icon)** located at the top right of the custom title bar.
2. In the Settings modal, locate the **Provider** dropdown.
3. Switch the provider from `Relay / Mock` to `Direct API`.
4. Paste your copied token into the **RapidAPI Key** input field.
5. Confirm the Host input field displays the default API endpoint: `youtube-video-fast-downloader-24-7.p.rapidapi.com`.
6. Click outside the modal or click **Close** to save and apply the new configuration.

Now, NovaTube will resolve incoming requests using your own RapidAPI endpoint key.
