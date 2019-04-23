const Config = require("../../config");
const ErrorStrings = require("../../errors").commands;
const Utils = require("../util");
const ErrorReply = require('../errorreply');

//JSDocs
/**
 * @typedef {import('discord.js').Message} DiscordMessage
 * @typedef {import('../manager')} Manager
 */

class DefaultCommand {
    /**
     * 
     * @param {Manager} mgr 
     * @param {CommandProperty} properties 
     * @param {string} name 
     */
    constructor(mgr, properties, name) {
        this._manager = mgr;
        this._isAlias = false;
        this._aliases = [];
        this._name = name;

        this._properties = properties;
    }

    //DO NOT OVERRIDE
    /**
     * 
     * @param {DiscordMessage} message 
     * @param {string[]} args 
     */
    exec(message, args) {
        let resp = checkProperties(message, args);
        if(resp == true) {
            return this.run(message, args);
        } else if(resp != false) {
            message.channel.send(ErrorReply.error(resp));
        }
        return false;
    }

    //User defined.
    //Return a new MessageResponse.
    /**
     * 
     * @param {DiscordMessage} message 
     * @param {string[]} args 
     */
    run(message, args) {
        return [false, ErrorStrings.notImplemented];
    }

    //Can be overridden, must return string error or true. False will fail without error.
    /**
     * 
     * @param {DiscordMessage} message 
     * @param {string[]} args 
     */
    checkProperties(message, args) {
        let props = this._properties;
        //Blacklist. Blacklist only has channels and users
        let channelID = message.channel.id;
        let highRole = message.member.highestRole;
        let roles = message.member.roles;
        let userID = message.member.id;
        let isBlacklisted = null;
        for(let item in props._blacklist) {
            let entry = props._blacklist[item];
            switch(entry.type) {
                case "user":
                    if(userID == entry.id) {
                        isBlacklisted = ErrorStrings.blacklistedUser;
                        break;
                    }
                break;
                case "channel":
                    if(channelID == entry.id) {
                        isBlacklisted = false;
                        break;
                    }
                break;
            }
        }
        if(isBlacklisted != null) 
            return isBlacklisted;

        //Whitelist. Whitelist only has roles and users
        let isWhitelisted = null;
        if(props._useWhitelist) {
            for (let item in props._whitelist) {
                //Can't break out of switch, if we are whitelisted, leave
                if(isWhitelisted)
                    break;

                let entry = props._whitelist[item];
                switch(entry.type) {
                    case "user":
                        if(entry.id == userID) {
                            isWhitelisted = true;
                        }
                    break;
                    case "role":
                        //Check if it is exact or ranked match
                        if(entry.exact) {
                            if(roles.get(entry.id) != null) {
                                isWhitelisted = true;
                            }
                        } else {
                            let lowRole = message.guild.roles.get(entry.id);
                            if (!(lowRole == null || lowRole.calculatedPosition > highRole.calculatedPosition)) {
                                isWhitelisted = true;
                            }
                        }
                    break;
                }
            }
            if(isWhitelisted != true) 
                return ErrorStrings.permissionError;
        }

        //Channel type
        if(!props._allowDM && message.channel.type == "dm")
            return ErrorStrings.dmDisabled;

        //Argument Limits
        if(props._minArgs != -1 && props._minArgs > args.length)
            return ErrorStrings.minArgLimit;
        if(props._maxArgs != -1 && props._maxArgs < args.length)
            return ErrorStrings.maxArgLimit;
        
        return true;
    }
}

class DefaultAlias {
    constructor(name, link) {
        this._name = name;
        this._isAlias = true;
        this._link = link;
    }

    exec(message, args) {
        this._link.exec(message, args);
    }
}

class CommandProperty {
    constructor(commandName) {
        this._command = commandName;
        this._minArgs = -1;
        this._maxArgs = -1;
        this._allowDM = true;
        //Fixed permissions means the permissions are not handled by the database
        this._fixedPermissions = true;
        /*Permissions have the following allowed entries:
            type: user, channel or role
            id: user id, channel id or role id. Can also be wildcard
            allowed: true/false - defaults to this._permissionDefault, and determines wether this rule is block or allow
        Permissions also follow the following rules:
            Whitelist is checked first, followed by blacklist
            If a user is on whitelist AND blacklist, blacklist takes preference
            Priority for whitelisting: role -> user
                IF the role || user is allowed, allow
                IF user is on both lists, force user to blacklist temporarily, repeatedly demand solution.
            Priority for blacklisting: user -> channel
                IF user || channel is blocked, deny

            Format: {type: "user/channel/role", id: "user id/channel id/role id"}
            For type: "role", there is also an additional optional property, 'exact': true/false
            If exact is true, the user must have the role
            If exact is false, if the user has a higher role, they will be able to use the commands.
        */
        //If this._fixedPermissions is false, this will be used as a default, then immediately overwritten.
        this._whitelist = [{type: "user", id: Config.owner}];
        this._blacklist = [];

        //this._useWhitelist:
        //  true: Only rules defined in whitelist are allowed, overridden by blacklist, default deny
        //  false: Default allow, blacklist is now used.
        this._useWhitelist = true;
    }

    /**
     * Must be run at the end of setting up the properties *only* if fixedPermissions is false
     */
    finish() {
        this._updatePermissions();
    }

    _updatePermissions() {
        let dbSys = this._manager.getSystem("Database");
        let dbRet = dbSys.getDatabase("cmd_lists");
        let db = dbRet._data;
        if(db == null) {
            this._whitelist = [];
            Utils.log(`CommandProperty ${this._command}`, "Failed to load whitelist database");
            return false;
        }
        if(db[this._command] == null) {
            db[this._command] = {whitelist: this._whitelist, blacklist: this._blacklist};
            Utils.log(`CommandProperty ${this._command}`, "Permission data does not exist, creating with default permissions.");
            dbSys.commit(dbRet);
        }
        this._whitelist = db[this._command].whitelist;
        this._blacklist = db[this._command].blacklist;
        Utils.log(`CommandProperty ${this._command}`, "Loaded permissions data");
    }

    setArgs(min, max) {
        this._minArgs = min;
        this._maxArgs = max;
        return this;
    }

    noArgs() {
        this._minArgs = -1;
        this._maxArgs = -1;
        return this;
    }

    allowDM(dm) {
        this._allowDM = dm;
        return this;
    }

    setFixedPermissions(val) {
        this._fixedPermissions = val;
        return this;
    }

    forceWhitelist(val) {
        this._useWhitelist = val;
        return this;
    }
}

module.exports = {DefaultCommand, DefaultAlias, CommandProperty};