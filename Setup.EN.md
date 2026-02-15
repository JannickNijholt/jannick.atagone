# ATAG One App Installation Guide for Homey

To install the ATAG One app on your Homey, you first need to collect some information.  
Follow the steps below to retrieve the required details and complete the installation successfully.

---

## 1. Retrieve the device name and email address

1. Open the **ATAG One app** on your phone.
2. Open the **hamburger menu (☰)** and go to **Settings**.
3. Select **Account**.
4. Go to **Devices**.
5. Note the **name of your ATAG One thermostat**.  
   This is the device name you will need later.
6. Go back and select **User information**.
7. Note the **email address** shown under *Email*.

---

## 2. Retrieve the IP address and MAC address

Go to your **ATAG One thermostat** and follow these steps:

1. Press the **large center button twice**.
2. Use the **right button** to go to **Settings** → press the **center button**.
3. Use the **right button** to go to **Information** → press the **center button**.
4. Use the **right button** to go to **Network** → press the **center button**.
5. Note the following:
   - The **IP address**
   - The **MAC address**

> If you do nothing for a few seconds, the screen will return to the default view.

---

## 3. Install the ATAG One app in Homey

1. Open the Homey app on your phone  
   **or** go to: https://my.homey.app in your browser.
2. Go to **Devices**.
3. Click **+ Add device**.
4. Search for **ATAG** and select **ATAG One**.
5. Choose **ATAG One 2.0** and click **Install**.
6. Enter the requested details:

   - **IP address**  
     Format: `xxx.xxx.xxx.xxx`  
     Example: `192.168.1.10`

   - **MAC address**  
     Format: `xx:xx:xx:xx:xx:xx`  
     Example: `ab:12:cd:34:ef:56`

   - **Device name**  
     Exactly as shown in the ATAG One app.

   - **Email address**  
     As shown in the ATAG One app.

7. Click **Connect**.

---

## ✔️ Done!

Your ATAG One 2.0 is now added to Homey and ready to use in flows and for control through the app.

---

## 🔧 Troubleshooting tips

- Make sure your **Homey and phone are connected to the same network**.
- Enter the **device name exactly** (including capital letters and spaces).
- If it doesn’t work right away, restart Homey and the thermostat.
