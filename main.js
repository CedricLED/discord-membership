const Discord = require("discord.js");
const bot = new Discord.Client();
const config = require("./config.json");
const sql = require("sqlite");
const schedule = require("node-schedule");
sql.open("./db.sqlite");
const moment = require("moment");
const fs = require("fs");
var keys = [];
var keysTwoWeek = [];
var redeemed = [];
var guild;
fs.readFile("./keys.csv", "utf8", function(err, data) {
  keys = data.replace(/(\r\n|\n|\r)/gm,"").split(",");
});
fs.readFile("./keysTwoWeek.csv", "utf8", function(err, data) {
  keysTwoWeek = data.replace(/(\r\n|\n|\r)/gm,"").split(",");
});
fs.readFile("./redeemed-keys.csv", "utf8", function(err, data) {
  redeemed = data.replace(/(\r\n|\n|\r)/gm,"").split(",");
});

String.prototype.isNumber = function() {
  return /^\d+$/.test(this);
};

String.prototype.dayify = function(value) {
  return this.replace(/<days>/gi, value.toString());
};

bot.login(config.token);

var logsChannel;
const dateFormat = "MMMM DD, YYYY";

bot.on("ready", () => {
  console.log(`Logged in as ${bot.user.username}!`);
  initSql();
  guild = bot.guilds.get(config.guild);
  logsChannel = guild.channels.get(config.logsChannelId);
  scanDatabase();
});

schedule.scheduleJob("0 0 * * *", function() {
  scanDatabase();
});


bot.on('guildMemberAdd', member => {
  member.send("");
});

bot.on("message", message => {
  if (message.author.bot) return;
  if (message.channel.type !== "text") {
    console.log("checking store");
    if (redeemed.includes(message.content)) {
      return message.reply("That key has already been redeemed");
    }
    for (let key of keys) {
      if (message.content === key) {
        vip(message, 30);
        fs.appendFileSync("./redeemed-keys.csv", key + "," + "\n");
        redeemed.push(key);
        return;
      }
    }
	for (let key of keysTwoWeek) {
      if (message.content === key) {
        vip(message, 7);
        fs.appendFileSync("./redeemed-keys.csv", key + "," + "\n");
        redeemed.push(key);
        return;
      }
    }
    message.reply("Not a valid key, please enter again");
  }

  ////////////////COMMANDS

  if (message.content.indexOf(config.prefix) !== 0) return;
  const args = message.content
    .slice(config.prefix.length)
    .trim()
    .split(/ +/g);
  const command = args.shift().toLowerCase();
  if (!message.content.startsWith(config.prefix)) return;

  if (command === "status") {
    status(message);
  }

  if (message.channel.type !== "text") return;
  if (command === "revoke") {
    if (!message.member.hasPermission("ADMINISTRATOR"))
      return message.reply("You do not have permission to use this command");
    revoke(message);
  }

  if (command === "verified-list") {
    if (!message.member.hasPermission("ADMINISTRATOR"))
      return message.reply("You do not have permission to use this command");
    listVip(message);
  }
});

function initSql() {
  sql.run(
    "CREATE TABLE IF NOT EXISTS users (userId TEXT, first_payment TEXT, last_payment TEXT, expires TEXT)"
  );
}

async function vip(message, length) {
  //add time
  let member = await findGuildMember(message, guild);
  let row = await sql.get(
    `SELECT * FROM users WHERE userId = ${member.user.id}`
  );
  if (!row) {
    let expiry = moment().add(length, "days");
    sql.run(
      "INSERT INTO users (userId, first_payment, last_payment, expires) VALUES (?, ?, ?,?)", [
        member.user.id,
        moment().toISOString(),
        moment().toISOString(),
        expiry.toISOString()
      ]
    );
    member.addRole(config.vipRoleID);
    member.send(config.grantedVipMSG);
    let newRow = await sql.get(
      `SELECT * FROM users WHERE userId = ${member.user.id}`
    );
    sendNewVipLog(message, member, newRow);

  } else {
    let expiry;
	if (moment(row.expires).isBefore(moment())) {
		expiry = moment().add(length, "days");
	} else {
		expiry = moment(row.expires).add(length, "days");
	}
    sql.run(
      `UPDATE users SET last_payment = "${moment().toISOString()}", expires = "${expiry.toISOString()}" WHERE userId = ${member
            .user.id}`
    );
    member.addRole(config.vipRoleID);
    let newRow = await sql.get(
      `SELECT * FROM users WHERE userId = ${member.user.id}`
    );
    sendNewVipLog(message, member, newRow);
    message.author.send(config.grantedVipMSG);
  }
}

async function scanDatabase() {
  console.log("Scanning database...");
  sql
    .each(`SELECT * FROM users`, async function(err, row) {
      if (err) console.log(err);
      let member = await guild.fetchMember(row.userId);
      if (!member) return;
      if (moment(row.expires).isSame(moment(), "day")) {
        member.removeRole(config.vipRoleID);
        member.send(config.youHaveExpiredMSG);
        sendExpiredLog(member, row);
      } else if (moment(row.expires).isBefore(moment())) {
        member.removeRole(config.vipRoleID);
      }
    });
}

async function status(message) {
  let row = await sql.get(
    `SELECT * FROM users WHERE userId = ${message.author.id}`
  );
  if (!row) {
    message.author.send("Are you sure you were verified? Contact an admin for help!");
    return;
  }
  let member = await guild.fetchMember(row.userId);
  const embed = new Discord.RichEmbed()
    .addField(
      "Verified",
      moment(row.first_payment).format(dateFormat),
      true
    )
    .addField("Verified last payment", moment(row.last_payment).format(dateFormat), true)
    .addField(
      "Verified expires",
      moment(row.expires).format(dateFormat),
      true
    );

  message.channel.send({
    embed
  });
}

async function revoke(message) {
  if (message.mentions.members.size == 0) {
    message.author.send("You must mention a user");

    return;
  }
  if (message.mentions.members.size > 1) {
    message.author.send("Please specify only 1 user");

    return;
  }
  let member = message.mentions.members.first();
  let row = await sql.get(
    `SELECT * FROM users WHERE userId = ${member.user.id}`
  );
  if (!row) {
    message.reply("User not found in Database.");
    return;
  }
  sql.run(
    `UPDATE users SET expires = "${moment().toISOString()}" WHERE userId = ${member
      .user.id}`
  );
  member.removeRole(config.vipRoleID);
  member.send(config.revokedMSG);
  message.author.send("done!");

  let newRow = await sql.get(
    `SELECT * FROM users WHERE userId = ${member.user.id}`
  );
  sendRevokedLog(message, member, newRow);
}

function sendExpiredLog(member, row) {
  const embed = new Discord.RichEmbed()
    .setTitle(
      "Verified has expired for " +
      member.user.username +
      "#" +
      member.user.discriminator
    )
    .setColor("#ff9900")
    .addField(
      "Verified",
      moment(row.first_payment).format(dateFormat),
      true
    )
    .addField("Verified last payment", moment(row.last_payment).format(dateFormat), true)
    .addField(
      "Verified expired",
      moment(row.expires).format(dateFormat),
      true
    );

  logsChannel.send({
    embed
  });
}

function sendRevokedLog(message, member, row) {
  const embed = new Discord.RichEmbed()
    .setTitle(
      "Verified was revoked from " +
      member.user.username +
      "#" +
      member.user.discriminator
    )
    .setColor("#ff0000")
    .addField("Revoked by", message.member.user.username, false)
    .addField(
      "Verified",
      moment(row.first_payment).format(dateFormat),
      true
    )
    .addField("Verified last payment", moment(row.last_payment).format(dateFormat), true)
    .addField(
      "Verified expired",
      moment(row.expires).format(dateFormat),
      true
    );

  logsChannel.send({
    embed
  });
}

async function listVip(message) {
  sql
    .each(`SELECT * FROM users`, async function(err, row) {
      if (err) console.log(err);
      let member = await guild.fetchMember(row.userId);
      if (!member) return;
      //member's time has expired
      if (moment(row.expires).isBefore(moment())) return;
      sendVipEmbed(message, member, row);
    });
}

function sendVipEmbed(message, member, row) {
  const embed = new Discord.RichEmbed()
    .setTitle(
      member.user.username + "#" + member.user.discriminator
    )
    .setColor(0x00ae86)
    .addField(
      "Verified",
      moment(row.first_payment).format(dateFormat),
      true
    )
    .addField("Verified last payment", moment(row.last_payment).format(dateFormat), true)
    .addField(
      "Verified expires",
      moment(row.expires).format(dateFormat),
      true
    );

  message.author.send({
    embed
  });
}



function sendNewVipLog(message, member, row) {
  const embed = new Discord.RichEmbed()
    .setTitle(
      "Verified " +
      member.user.username +
      "#" +
      member.user.discriminator
    )
    .setColor("#0000ff")
    .addField("Key Used", message.content, false)
    .addField(
      "Verified",
      moment(row.first_payment).format(dateFormat),
      true
    )
    .addField("Verified Last Payment", moment(row.last_payment).format(dateFormat), true)
    .addField(
      "Verified expires",
      moment(row.expires).format(dateFormat),
      true
    );

  logsChannel.send({
    embed
  });
}

async function broadcast(message, args) {
  let vipMembers = findVipMembers(guild);
  let str = "";
  for (let word of args) {
    str += word + " ";
  }
  for (let member of vipMembers.values()) {
    member.send(str);
  }

  message.author.send("done!");

}

function findVipMembers(guild) {
  //rolesArr contains an array of role names
  return guild.members.filter(member => {
    if (!member.roles.has(config.vipRoleID)) {
      //console.log(member.user.username + " does not have role: " + value + ". Returning false.");
      return false;
    } else return true;
  });
}



function findGuildMember(message, guild) {
  return guild.fetchMember(message.author.id);
}
