const axios = require("axios");
const fs = require("fs-extra");
const path = require("path");

const baseApiUrl = async () => {
  const base = await axios.get("https://raw.githubusercontent.com/mahmudx7/HINATA/main/baseApiUrl.json");
  return base.data.mahmud;
};

module.exports = {
        config: {
                name: "profile",
                aliases: ["pp", "dp", "pfp"],
                version: "1.1",
                author: "MahMUD",
                countDown: 5,
                role: 0,
                description: {
                        bn: "ব্যবহারকারীর প্রোফাইল পিকচার ডাউনলোড করুন",
                        en: "Fetch user's profile picture"
                },
                category: "utility",
                guide: {
                        bn: '   {pn}: আপনার নিজের প্রোফাইল পিকচার দেখুন'
                                + '\n   {pn} <@tag>: ট্যাগ করা ব্যক্তির প্রোফাইল পিকচার দেখুন'
                                + '\n   {pn} <uid>: UID এর মাধ্যমে প্রোফাইল পিকচার দেখুন'
                                + '\n   {pn} <profile_link>: ফেসবুক প্রোফাইল লিংকের মাধ্যমে ছবি দেখুন'
                                + '\n   (অথবা কারো মেসেজে রিপ্লাই দিয়ে এটি ব্যবহার করুন)',
                        en: '   {pn}: Fetch your profile picture'
                                + '\n   {pn} <@tag>: Fetch tagged user\'s profile picture'
                                + '\n   {pn} <uid>: Fetch profile picture from UID'
                                + '\n   {pn} <profile_link>: Fetch profile picture from profile link'
                                + '\n   (Or reply to someone\'s message)'
                }
        },

        langs: {
                bn: {
                        success: ">🎀 %1\nবেবি, এই নাও তোমার প্রোফাইল 😘",
                        error: "× প্রোফাইল পিকচার আনতে সমস্যা হয়েছে, Contact MahMUD %1",
                        invalidUID: "! সঠিক UID বা লিংক প্রদান করুন"
                },
                en: {
                        success: ">🎀 %1\n𝐁𝐚𝐛𝐲, 𝐇𝐞𝐫𝐞'𝐬 𝐲𝐨𝐮𝐫 𝐩𝐫𝐨𝐟𝐢𝐥𝐞 😘",
                        error: "× Could not fetch profile picture, Contact MahMUD %1",
                        invalidUID: "! Invalid UID"
                }
        },

        onStart: async function ({ api, message, args, event, getLang, usersData }) {
                     const authorName = String.fromCharCode(77, 97, 104, 77, 85, 68);
                        if (this.config.author !== authorName) {
                        return api.sendMessage("You are not authorized to change the author name.", event.threadID, event.messageID);}
          
                       try {
                        let uid = event.senderID;
                        
                        if (event.messageReply) {
                                uid = event.messageReply.senderID;
                        } else if (Object.keys(event.mentions).length > 0) {
                                uid = Object.keys(event.mentions)[0];
                        } else if (args[0]) {
                                if (!isNaN(args[0])) {
                                        uid = args[0];
                                } else if (args[0].includes("facebook.com/")) {
                                        const match = args[0].match(/(?:profile\.php\?id=|\/)([\d]+)/);
                                        if (match) uid = match[1];
                                }
                        }
                        
                        if (!uid || isNaN(uid))
                                return message.reply(getLang("invalidUID"));
                        
                        const baseUrl = await baseApiUrl();
                        const avatarURL = `${baseUrl}/api/pfp?mahmud=${uid}`;
                        const userName = await usersData.getName(uid);
                        
                        const cachePath = path.join(__dirname, "cache", `pfp_${uid}.jpg`);
                        await fs.ensureDir(path.dirname(cachePath));
                        
                        const response = await axios.get(avatarURL, { responseType: "arraybuffer" });
                        await fs.writeFile(cachePath, Buffer.from(response.data));
                       
                        await message.reply({
                                body: getLang("success", userName),
                                attachment: fs.createReadStream(cachePath)
                        });
                        
                        await fs.remove(cachePath);
                } catch (err) {
                        console.error("Error in pfp command:", err);
                        return message.reply(getLang("error", err.message));
                }
        }
};
