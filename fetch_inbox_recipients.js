import fs from "node:fs";

// Session Cookie for @milespete
const COOKIE = "ll_dev=2l08616a3s395t0d; ll_vid=102f439367af4102b904; ll_session=a0a199276c31c3ab9e62c542f465532eecbeb7f480adf58fbd8eb8f33c799094; ll_pass=eyJpIjoiYmM3NDU4Mzc5MzVkNDVlZmJmNDciLCJ1IjoibWlsZXNwZXRlIiwibiI6Ik1pbGVzIFBldGVyIiwidCI6IjJ4cFplb2VObGZYTEh0VUEiLCJlIjoxNzkyMTE2NTM0MzY2fQ.UJWqc2tFrMVPbXnnolCqfipkguVBoB6SzJPvwJznxsQ";

const OUT_FILE = "./recipients_to_message.json";
const INBOX_BACKUP = "./inbox_threads_full.json";

async function fetchInbox() {
  console.log("📥 Fetching all inbox threads from LagosLife for @milespete...");
  
  try {
    const resp = await fetch("https://lagoslife.app/api/messages", {
      headers: {
        "accept": "application/json",
        "cookie": COOKIE,
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
      }
    });

    if (!resp.ok) {
      console.error(`❌ Failed to fetch inbox: HTTP ${resp.status}`, await resp.text());
      return;
    }

    const data = await resp.json();
    const threads = data.threads || [];
    console.log(`✅ Retrieved ${threads.length} total message threads!`);

    // Save full raw dump
    fs.writeFileSync(INBOX_BACKUP, JSON.stringify(data, null, 2));
    console.log(`💾 Saved full raw inbox backup to: ${INBOX_BACKUP}`);

    // Map into clean recipient list for bulk message sender
    const recipients = threads.map(t => ({
      id: t.id,
      username: t.username ? `@${t.username}` : "Unknown",
      name: t.name || t.username || "Player",
      unread: t.unread || 0,
      online: Boolean(t.online),
      lastMessage: t.last ? t.last.body : ""
    }));

    // Save to recipients file
    fs.writeFileSync(OUT_FILE, JSON.stringify(recipients, null, 2));
    console.log(`📋 Saved ${recipients.length} recipients to: ${OUT_FILE}`);

    // Summary breakdown
    const unreadCount = recipients.filter(r => r.unread > 0).length;
    const onlineCount = recipients.filter(r => r.online).length;
    console.log(`\n📊 Inbox Stats:`);
    console.log(`   - Total Senders: ${recipients.length}`);
    console.log(`   - With Unread Messages: ${unreadCount}`);
    console.log(`   - Currently Online: ${onlineCount}`);
    console.log(`\n✨ You can now run 'node bulk_message_sender.js' to respond!`);

  } catch (err) {
    console.error("Error fetching inbox:", err.message);
  }
}

fetchInbox();
