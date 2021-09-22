const SerialPort = require('serialport');
const ByteLength = require('@serialport/parser-byte-length');
const SHT31 = require('raspi-node-sht31');
const sht31 = new SHT31();
const sensorBox = require("node-dht-sensor");
const Colors = require('colors');
const cron = require('node-cron');
const { DateTime } = require("luxon");
require('dotenv').config();

const colors = require('colors')

const Client = require('azure-iot-device').Client;
const ConnectionString = require('azure-iot-device').ConnectionString;
const Message = require('azure-iot-device').Message;
const MqttProtocol = require('azure-iot-device-mqtt').Mqtt;

const gpio = require('onoff').Gpio;

// ===================== CO2 =======================

//Conectar puerto serie
const port = new SerialPort('/dev/ttyAMA0', {
    baudRate: 9600
}, function(err) {
    if (err) {
        return console.log('Error: ', err.message);
    }
});
//parser que recibe 7 bytes
const parser = port.pipe(new ByteLength({ length: 7 }));

//bytes para el request del CO2 al sensor
const req = Buffer.alloc(7, 'FE440008029F25', 'hex');

let CO2;
let timeStamp;
let temp;
let hum;
let tempBox;
let humBox;

//funcion que se llama a si misma cada 2 seg y manda el request
const sendReq = () => {
    port.write(req);
    // console.log("Enviado comando");
    setTimeout(sendReq, 2000);
    return;
}

//listener que recibe datos del puerto serie
parser.on('data', function(data) {

    timeStamp = new Date();


    CO2 = (data[3] * 256 + data[4]) * 10;
    // console.log(`timestamp: ${ timeStamp.toLocaleString() }`);
    // console.log(`CO2: ${CO2} ppm`);

    //ALERTAS y LEDS
    if (CO2 <= 800) {

        blinkLED('green');

        prealerta = false;
        alerta = false;

    } else
    if (CO2 > 800 && CO2 <= 1200) {

        blinkLED('yellow');

        prealerta = true;
        alerta = false;
    } else {

        blinkLED('red');

        prealerta = false;
        alerta = true;
    }


    // ---- TEMP/HUM ----
    sht31.readSensorData().then((data) => {

        temp = parseFloat(data.temperature.toFixed(2));
        hum = parseFloat(data.humidity.toFixed(2));
        // console.log(`temp: ${temp}°C, humidity: ${hum}%`);

    }).catch(console.log);

    // -----TEMP/HUM inside box -----
    sensorBox.read(11, 4, function(err, temperature, humidity) {
        if (!err) {
            tempBox = temperature;
            humBox = humidity;
            //console.log(`temp: ${temp}°C, humidity: ${hum}%`);
        } else {
            console.log('error en lectura de sensor temp/hum de caja: \n'.red + err);
        }
    });

    var lec = `==================================\n`.green +
        `=== NUEVA LECTURA CO2/TEMP/HUM ===\n`.green +
        `==================================\n`.green +
        //`Data:` + data + `\n` +
        `timestamp: ${ timeStamp.toLocaleString() }\n` +
        `CO2: ${CO2} ppm\n` +
        `temp: ${temp}°C, hum: ${hum}%\n` +
        `temp inside box: ${tempBox}°C, hum inside box: ${humBox}%`

    console.log(lec);
    console.log('Data:', data);

});

//Conexion BD Mongo Atlas
// const conectarDB = async() => {
//    await dbConnect();
// }
// conectarDB();

//guardar en base de datos lecturas co2/temp/hum cada 1 minutos
cron.schedule('1 * * * * *', () => {
    // console.log('guardando en base de datos...'.yellow);
    let datos_lec = {
        messageId,
        deviceId,
        timestamp: timeStamp, //.toLocaleString(),
        timestampLocal: timeStamp.toLocaleString(),
        CO2 /*: `${CO2} ppm`*/ ,
        temp /*: `${temp} C`*/ ,
        hum /*: `${hum} %`*/ ,
        tempBox,
        humBox
    };
    // console.log(datos);
    //          guardarDB_lec(datos_lec);
    //guardar en csv en local
    // csvWriter.writeRecords([datos])       // returns a promise
    // .then(() => {
    //     console.log('Guardado en csv local'.blue);
    // });

    // MANDAR a IoT HUB
    sendMessage(JSON.stringify(datos_lec))

});



// ===================== AZURE IoT Hub =======================

var isMessageSendOn = true;
var messageId = 0;
var client;

var alerta = false;
var prealerta = false;

var connectionString = ConnectionString.parse(process.env.IOTHUB_CON);
var deviceId = connectionString.DeviceId;

client = Client.fromConnectionString(process.env.IOTHUB_CON, MqttProtocol);

function onStart(request, response) {
    console.log('[Device] Trying to invoke method start(' + request.payload || '' + ')');

    isMessageSendOn = true;

    response.send(200, 'Successully start sending message to cloud', function(err) {
        if (err) {
            console.error('[IoT Hub Client] Failed sending a start method response due to:\n\t' + err.message);
        }
    });
}

function onStop(request, response) {
    console.log('[Device] Trying to invoke method stop(' + request.payload || '' + ')');

    isMessageSendOn = false;

    response.send(200, 'Successully stop sending message to cloud', function(err) {
        if (err) {
            console.error('[IoT Hub Client] Failed sending a stop method response due to:\n\t' + err.message);
        }
    });
}

function receiveMessageCallback(msg) {

    var message = msg.getData().toString('utf-8');

    client.complete(msg, () => {
        console.log('Received message:\n\t' + message);
    });
}


client.open((err) => {
    if (err) {
        console.error('[IoT Hub Client] Connect error:\n\t' + err.message);
        return;
    }

    // set C2D and device method callback
    client.onDeviceMethod('start', onStart);
    client.onDeviceMethod('stop', onStop);
    client.on('message', receiveMessageCallback);
});

function sendMessage(content) {
    if (!isMessageSendOn) { return; }

    messageId++;

    var message = new Message(content.toString('utf-8'));
    message.contentEncoding = 'utf-8';
    message.contentType = 'application/json';
    message.properties.add('CO2_preAlert', prealerta);
    message.properties.add('CO2_Alert', alerta);

    console.log('enviando mensaje a IoT Hub: '.yellow + content);

    client.sendEvent(message, (err) => {
        if (err) {
            console.error('[Device] Failed to send message to Azure IoT Hub due to:\n\t'.red + err.message);
        } else {
            console.log('[Device] Message sent to Azure IoT Hub'.green);
        }
    });
}



function blinkLED(color) {
    // Light up LED for 500 ms
    const ledGreen = new gpio('23', 'out');
    const ledYellow = new gpio('24', 'out');
    const ledRed = new gpio('25', 'out');

    if (color == 'green') {
        ledGreen.writeSync(1);
        ledYellow.writeSync(0);
        ledRed.writeSync(0);
    } else
    if (color == 'yellow') {
        ledGreen.writeSync(0);
        ledYellow.writeSync(1);
        ledRed.writeSync(0);
    } else
    if (color = 'red') {
        ledGreen.writeSync(0);
        ledYellow.writeSync(0);
        ledRed.writeSync(1);
    } else {
        console.log('esto no debera pasar');
    }

}

//ejecutamos por primera vez la función de enviar el req
sendReq();