#!/bin/bash

echo "iniciando monitoreo de pm2 en 10 seg. pulse ctr+c para cancelar"
sleep 10
echo "iniciando monitoreo"
/home/pi/.config/nvm/versions/node/v15.11.0/bin/pm2 monit