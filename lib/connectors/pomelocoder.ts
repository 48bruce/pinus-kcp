/**
 * Copyright 2016 leenjewel
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

let supportPomeloPackage = true;

const pinusRequire = function (requirePath: string) {
    let pinusPath = __dirname + '/../../../../pinus/dist/lib/';
    try {
        return require(pinusPath + requirePath);
    } catch (e) {
        supportPomeloPackage = false;
        return undefined;
    }
};
// let util = require('util');
import * as util from 'util';
const utils = pinusRequire('./util/utils');
const handler = pinusRequire('./connectors/common/handler');
const Constants = pinusRequire('./util/constants');
const Kick = pinusRequire('./connectors/commands/kick');
const Handshake = pinusRequire('./connectors/commands/handshake');
const Heartbeat = pinusRequire('./connectors/commands/heartbeat');
const coder = pinusRequire('./connectors/common/coder');
const Pinus = pinusRequire('./');
const pinus = Pinus.pinus;
import { IConnector } from '../interfaces/IConnector';

import {Protocol, Package, Message} from 'pinus-protocol';
// const Package = Protocol.Package;
// const Message = Protocol.Message;
supportPomeloPackage = true;
// let protocol;
// let Package;
// let Message;
// try {
//     protocol = require('pomelo-protocol');
//     Package = protocol.Package;
//     Message = protocol.Message;
// } catch (e) {
//     supportPomeloPackage = false;
//     protocol = undefined;
//     Package = undefined;
//     Message = undefined;
// }

// try {
//     let protobuf = require('pomelo-protobuf');
// } catch (e) {
//     supportPomeloPackage = false;
//     let protobuf = undefined;
// }
import { Protobuf } from 'pinus-protobuf';
import { ISocket } from '../interfaces/ISocket';

const RES_OK = 200;
// let protocol: any;
let protobuf: any;

export const getApp = function () {
    if (!!pinus) {
        return pinus.app;
    }
};

export const encode = function (reqid: number, route: string, msg: object) {
    if (supportPomeloPackage) {
        // return coder.encode.bind(this)(reqid, route, msg);
        return coder.encode(reqid, route, msg);
    } else {
        return JSON.stringify({
            id: reqid,
            route,
            body: msg
        });
    }
};

export function decode(msg: Buffer): string;
export function decode(msg: string): string;
export function decode(msg: any) {
    if (supportPomeloPackage) {
        // return coder.decode.bind(this)(msg);
        return coder.decode(msg);
    } else {
        if (msg instanceof Buffer) {
            return JSON.parse(msg.toString());
        } else if (typeof msg === 'string') {
            return JSON.parse(msg);
        } else {
            return '';
        }
    }
}

export const setupHandler = function (connector: any, socket: any, opts: any) {
    if (supportPomeloPackage) {
        connector.handshake = connector.handshake || new Handshake(opts);
        if (!connector.heartbeat) {
            if (!opts.heartbeat) {
                opts.heartbeat = opts.interval / 1000;
                opts.timeout = opts.heartbeat * 2;
            }
            if (opts.heartbeat * 1000 < opts.interval) {
                console.warn('heartbeat interval must longer than kcp interval');
                opts.heartbeat = opts.interval / 1000;
            }
            if (opts.timeout * 1000 < 2 * opts.interval) {
                console.warn('timeout must longer than kcp interval * 2');
                opts.timeout = opts.heartbeat * 2;
            }
            connector.heartbeat = new Heartbeat(utils.extends(opts, { disconnectOnTimeout: true }));
        }
        socket.on('handshake',
            connector.handshake.handle.bind(connector.handshake, socket));
        socket.on('heartbeat',
            connector.heartbeat.handle.bind(connector.heartbeat, socket));
        socket.on('disconnect',
            connector.heartbeat.clear.bind(connector.heartbeat, socket.id));
        socket.on('disconnect', function () {
            connector.emit('disconnect', socket);
        });
        socket.on('closing', Kick.handle.bind(null, socket));
    }
};

export const handlePackage = function (socket: any, pkg: any) {
    if (!!pkg && supportPomeloPackage) {
        pkg = Package.decode(pkg);
        if (Array.isArray(pkg)) {
            for (let p in pkg) {
                if (isHandshakeACKPackage(pkg[p].type)) {
                    socket.state = 2; // ST_WORKING
                }
                handler(socket, pkg[p]);
            }
        } else {
            if (isHandshakeACKPackage(pkg.type)) {
                socket.state = 2; // ST_WORKING
            }
            handler(socket, pkg);
        }
    } else {
        socket.emit('message', pkg);
    }
};

let heartbeatInterval = 0;
export const getHeartbeatInterval = function () { return heartbeatInterval; };
let heartbeatTimeout = 0;
export const getHeartbeatTimeout = function () { return heartbeatTimeout; };
let pomeloCoderData: { dict: any, abbrs: any , protos: any} = { dict: null, abbrs: null , protos: null};
export const initProtocol = function (data: any) {
    if (!!data && supportPomeloPackage) {
        if (data.code !== RES_OK) {
            console.warn('Handshake response code : ' + data.code);
            return;
        }
        if (!data || !data.sys) {
            console.warn('Handshake response sys is undefained');
            return;
        }
        if (!!data.sys && !!data.sys.heartbeat) {
            heartbeatInterval = data.sys.heartbeat * 1000;
            heartbeatTimeout = heartbeatInterval * 2;
        }
        let dict = data.sys.dict;
        let protos = data.sys.protos;
        if (!!dict) {
            pomeloCoderData.dict = dict;
            pomeloCoderData.abbrs = {};

            for (let route in dict) {
                pomeloCoderData.abbrs[dict[route]] = route;
            }
        }
        if (!!protos) {
            pomeloCoderData.protos = {
                server: protos.server || {},
                client: protos.client || {}
            };
            if (!!Protobuf) {
                protobuf = new Protobuf({
                    encoderProtos: protos.client,
                    decoderProtos: protos.server
                });
            }
        }
    }
};

export const handshakePackage = function (userdata: object) {
    userdata = userdata || {};
    return (Package.encode(
        Package.TYPE_HANDSHAKE,
        Protocol.strencode(JSON.stringify({
            sys: {
                version: '1.1.1',
                type: 'socket'
            },
            user: userdata
        }))
    ));
};

let pomeloHandshakeAckPkg = Package.encode(Package.TYPE_HANDSHAKE_ACK);
export const handshakeAckPackage = function () {
    return pomeloHandshakeAckPkg;
};

let pomeloHeartbeatPkg = Package.encode(Package.TYPE_HEARTBEAT);
export const heartbeatPackage = function () {
    return pomeloHeartbeatPkg;
};

export const messagePackage = function (reqid: number, route: string, msg: any) {
    let type = reqid ? Message.TYPE_REQUEST : Message.TYPE_NOTIFY;
    let protos = !!pomeloCoderData.protos ? pomeloCoderData.protos.client : {};
    if (!!protos[route]) {
        msg = protobuf.encode(route, msg);
    } else {
        msg = Protocol.strencode(JSON.stringify(msg));
    }
    let compressRoute = 0;
    if (!!pomeloCoderData.dict && !!pomeloCoderData.dict[route]) {
        route = pomeloCoderData.dict[route];
        compressRoute = 1;
    }
    msg = Message.encode(reqid, type, !!compressRoute, route, msg);
    return Package.encode(Package.TYPE_DATA, msg);
};

export const isHandshakePackage = function (type: number) {
    return (supportPomeloPackage && type == Package.TYPE_HANDSHAKE);
}

export const isHandshakeACKPackage = function (type: number) {
    return (supportPomeloPackage && type == Package.TYPE_HANDSHAKE_ACK);
}

export const isHeartbeatPackage = function (type: number) {
    return (supportPomeloPackage && type == Package.TYPE_HEARTBEAT);
}

export const isDataPackage = function (type: number) {
    return (supportPomeloPackage && type == Package.TYPE_DATA);
}

export const isKickPackage = function (type: number) {
    return (supportPomeloPackage && type == Package.TYPE_KICK);
}

export const kcpHeadDecode = function (bytes: Buffer) {
    //小端
    let offset = 0;
    let conv = ((bytes[offset++]) | (bytes[offset++] << 8) | (bytes[offset++] << 16) | (bytes[offset++] << 24)) >>> 0;
    let cmd = bytes[offset++];
    let frg = bytes[offset++];
    let wnd = ((bytes[offset++]) | (bytes[offset++] << 8)) >>> 0;
    let ts = ((bytes[offset++]) | (bytes[offset++] << 8) | (bytes[offset++] << 16) | (bytes[offset++] << 24)) >>> 0;
    let sn = ((bytes[offset++]) | (bytes[offset++] << 8) | (bytes[offset++] << 16) | (bytes[offset++] << 24)) >>> 0;
    let una = ((bytes[offset++]) | (bytes[offset++] << 8) | (bytes[offset++] << 16) | (bytes[offset++] << 24)) >>> 0;
    let len = ((bytes[offset++]) | (bytes[offset++] << 8) | (bytes[offset++] << 16) | (bytes[offset++] << 24)) >>> 0;

    let rs = {
        conv: conv,
        cmd: cmd,
        frg: frg,
        wnd: wnd,
        ts: ts,
        sn: sn,
        una: una,
        len: len
    };

    // if (bytes.length >= len + 24) {
    //     rs.data = Buffer.from(bytes, 24, len);
    // }
    return rs;
};

export const coders = {
    decodePackage: Package.decode,
    decodeMessage: Message.decode,
};

