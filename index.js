// index.js


const serverless = require('serverless-http');

const express = require('express')
const bodyParser = require('body-parser');

const app = express()

const https = require('https');
var request = require('request');

const uuid = require('uuid');
const AWS = require('aws-sdk');

const dynamoDb = new AWS.DynamoDB.DocumentClient();

const userDBTable = 'homeoffice-homie-usersTable';
const activeTasksDBTable = 'homeoffice-homie-activeTasksTable';

const slackClientID = 'REPLACE-ME';
const slackClientSecret = 'REPLACE-ME';

app.use(function(req, res, next) {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  next();
});

function loadUserDBEnty(userID, callback) {
  var entry = false;
  const queryParams = {
    TableName: userDBTable,
    KeyConditionExpression: "userID = :user",
    ExpressionAttributeValues: {
      ":user": userID
    },
  };
  dynamoDb.query(queryParams, (err, data) => {
    if (err) {
      callback(entry, err);
    } else {
      callback(data.Items[0]);
    }
  });
}

function loadUserDBEntryBySlackID(slackID, callback) {
  var entry = false;
  const queryParams = {
    TableName: userDBTable,
    IndexName: 'slack_index',
    KeyConditionExpression: "slackID = :user",
    ExpressionAttributeValues: {
      ":user": slackID
    },
  };
  console.log(JSON.stringify(queryParams));
  dynamoDb.query(queryParams, (err, data) => {
    if (err) {
      console.log(err);
      callback(entry, err);
    } else {
      callback(data.Items.length > 0 ? data.Items[0] : false);
    }
  });
}

function loadUserTasks(userID, callback) {
  var entry = false;
  const queryParams = {
    TableName: activeTasksDBTable,
    KeyConditionExpression: "userID = :user",
    IndexName: 'main_index',
    ExpressionAttributeValues: {
      ":user": userID
    },
  };
  dynamoDb.query(queryParams, (err, data) => {
    if (err) {
      callback(entry, err);
    } else {
      callback(data.Items);
    }
  });
}

function loadSingleTask(userID, taskID, assignedAt, callback) {
  var entry = false;
  const queryParams = {
    TableName: activeTasksDBTable,
    KeyConditionExpression: "userID = :user",
    IndexName: 'main_index',
    ExpressionAttributeValues: {
      ":user": userID
    },
  };
  dynamoDb.query(queryParams, (err, data) => {
    if (err) {
      console.log(err);
      callback(entry, err);
    } else {
      var filteredResult = data.Items.filter(el => el['assignedAt'] == assignedAt).filter(el => el['taskID'] == taskID);
      callback(filteredResult.length > 0 ? filteredResult[0]: false);
    }
  });
}

function putOrUpdateUserTask(userID, activeTaskItem, assignedAt, taskID, callback) {

    var doSave = () => {
      var dbParams = {
        TableName: activeTasksDBTable,
        Item: activeTaskItem
      };
      dynamoDb.put(dbParams, (error) => {
          callback(error)
      });
    };

    activeTaskItem['userID'] = userID;
    activeTaskItem['assignedAt'] = assignedAt;
    activeTaskItem['taskID'] = taskID;
    if (!activeTaskItem['id']) {
      loadSingleTask(userID, taskID, assignedAt, (item) => {
        if (item)
        {
          activeTaskItem['id'] = item['id'];
        } else {
          activeTaskItem['id'] = uuid.v1();
        }
        doSave();
      });
    } else {
      doSave();
    }
}

function putOrUpdateUserEntry(userID, userEntry, callback) {

  var doSave = () => {
    var dbParams = {
      TableName: userDBTable,
      Item: userEntry
    };
    dynamoDb.put(dbParams, (error) => {
        callback(error)
    });
  };

  userEntry['userID'] = userID;
  loadUserDBEnty(userID, (item) => {
    if (item)
    {
      userEntry = Object.assign({}, item, userEntry);
    }
    doSave();
  });
}

function assignTask(userID, task, challangeNo, callback) {
  const timestamp = new Date().getTime();
  putOrUpdateUserTask(userID, {}, timestamp, task['id'], () => {
    loadUserDBEnty(userID, (entry, error) => {
      if (entry) {
        var accessTokenData = JSON.parse(entry.accessToken);
        sendSlackTask(accessTokenData.access_token, accessTokenData.user_id, task, challangeNo, timestamp, (data) => { callback(false) });
        return;
      } else {
        callback(error);
      }
    });
  });
}

function loadSlackTockens(userID, callback)
{
  loadUserDBEnty(userID, (entry) => {
    if (!entry) {
      callback(false, {error: 'Invalid user id'});
    }
    try {
      var accessTokenData = JSON.parse(entry.accessToken);
      if (accessTokenData['access_token']) {
        callback(true, {userChannel: accessTokenData['user_id'], token: accessTokenData['access_token']});
      } else {
        callback(false, {error: 'Invalid access token'});
      }
    } catch (err) {
      callback(false, {error: err});
    }
  });
}

function sendSlackMessage(userID, text, callback) {

  loadSlackTockens(userID, (success, data) => {
    if (!success) {
      callback(false, data);
      return;
    }

    var baseURL = "https://slack.com";
    var path = "/api/chat.postMessage?";
    path += '&token=' + encodeURI(data.token);
    path += '&channel=' + encodeURI(data.userChannel);
    path += '&text=' + encodeURI(text);

    https.get(baseURL, {
      path: path,
      method: 'POST'
    }, (message) => {
        message.setEncoding('utf8');
        let rawData = '';
        message.on('data', (chunk) => { rawData += chunk; });
        message.on('end', () => { callback(true, rawData); });
    });

  });
    
}

function sendSlackTask(token, channel, task, challangeNo, assignedAt, callback) {
  var baseURL = "https://slack.com";
  var path = "/api/chat.postMessage?";
  path += '&token=' + encodeURI(token);
  path += '&channel=' + encodeURI(channel);
  path += '&text=' + encodeURI('Challange ' + challangeNo);
  path += "&blocks=" + encodeURI(JSON.stringify(buildTaskBlocks(task, challangeNo, assignedAt)));

  https.get(baseURL, {
    path: path,
    method: 'POST'
  }, (message) => {
      message.setEncoding('utf8');
      let rawData = '';
      message.on('data', (chunk) => { rawData += chunk; });
      message.on('end', () => { callback(rawData); });
  });
}

function buildTaskBlocks(task, challangeNo, assignedAt) {
  return [{
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Challange:* " + task['title'] + " [" + task['focus_area'] + "]"
      }
    },
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": task['description']
      }
    },
    {
      "type": "actions",
      "elements": [
        {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": ":heavy_check_mark: Done",
            "emoji": true
          },
          "value": "done-" + task['id'] + '-' + challangeNo + '-' + assignedAt
        },
                {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": ":negative_squared_cross_mark: Not today",
            "emoji": true
          },
          "value": "deny-" + task['id'] + '-' + challangeNo + '-' + assignedAt
        }
        /*,
                {
          "type": "button",
          "text": {
            "type": "plain_text",
            "text": ":arrows_clockwise: Find me something else",
            "emoji": true
          },
          "value": "other-" + task['id'] + '-' + challangeNo + '-' + assignedAt
        }*/
      ]
    }
  ];
}

const testTask = 
[
  {
    "id": 1,
    "focus_area": "Socializing im Homeoffice",
    "title": "Leider kein Tischkicker",
    "description": "Nach Stunden harter Arbeit steht eine wohlverdiente Pause an. Nur leider fehlen die Kollegen und der Tischkicker. Fordere einen Kollegen zu einer Partie Tic Tac Toe (https://lonely.engineer/tic-tac-toe/) via Slack heraus."
  },
  {
    "id": 2,
    "focus_area": "Socializing im Homeoffice",
    "title": "Game-Break Royale",
    "description": "Organisiere eine digitale Scribble challenge in deinem Team (https://skribbl.io)."
  },
  {
    "id": 3,
    "focus_area": "Socializing im Homeoffice",
    "title": "Small Talk Like a Pro",
    "description": "Dir fehlt der  informelle soziale Austausch? Du willst einfach mal wieder ein bisschen plaudern mit jemandem der nicht in den gleichen vier Wänden wie du lebt? Baue 5 Minuten vor einem Meeting ein für Small Talk - rede nicht über die Arbeit!"
  },
  {
    "id": 4,
    "focus_area": "Socializing im Homeoffice",
    "title": "Das Gespräch ohne Worte",
    "description": "Dir fehlt das rumalbern mit Kollegen im Büro? Führe eine Chat-Konversation mit einem Kollegen und verwende nur Emojis und Gifs für die Kommunikation."
  },
  {
    "id": 5,
    "focus_area": "Socializing im Homeoffice",
    "title": "Instafame",
    "description": "Du kannst nicht mehr entspannt mit deinen Kollegen Mittagessen oder Kaffeetrinken gehen? Lass deine Kollegen wissen, dass du beim Essen oder Kaffetrinken an sie denkst und sende ihnen ein Bild in deiner Kaffee- oder Mittagspause."
  },
  {
    "id": 6,
    "focus_area": "Socializing im Homeoffice",
    "title": "Der digitale Kaffeeklatschprofi",
    "description": "Dir fehlen die gewohnten informellen sozialen Austausche? Dir fällt die Decke auf den Kopf? Trinke einen virtuellen Kaffee mit deinen Kollegen."
  },
  {
    "id": 7,
    "focus_area": "Socializing im Homeoffice",
    "title": "Afterwork 2.0",
    "description": "Die Arbeit ist geschafft, die Luft ist raus. Das Afterwork Get-Together ist ein festes Ritual, aber physisch leider nicht möglich. Lade deine Kollegen heute zu einem Feierabendbier oder Getränk deiner Wahl via Video-Conference ein. Bonustask: Mach ein Bild deiner virtuellen Afterwork-Party und share es auf LinkedIn, Facebook, Insta, Twitter‚ o.ä."
  },
  {
    "id": 8,
    "focus_area": "Effektive Remote Meetings",
    "title": "Kamera an!",
    "description": "Um die Aufmerksamkeit aller Beteiligten im Meeting zu haben sollte die Kamera eingeschaltet sein. Schalte deine Kamera in allen Meetings heute ein und fordere deine Kollegen auf dies auch zu tun."
  },
  {
    "id": 9,
    "focus_area": "Effektive Remote Meetings",
    "title": "Meeting Minutes live",
    "description": "Was wurde nochmal besprochen? Wer übernimmt jetzt welche Aufgabe? Das habe ich akustisch jetzt nicht verstanden... Schreibe bei jedem Meeting live Meeting Minutes während du deinen Bildschirm teilst und alle Beteiligten die notierten Themen und Aufgaben direkt sehen können. Im Optimalfall nutzt du dafür Tools wie Google Docs, Dropbox Paper o.ä. wo deine Kollegen direkt auch editieren können."
  },
  {
    "id": 10,
    "focus_area": "Effektive Remote Meetings",
    "title": "Pausen kommunizieren und einhalten",
    "description": "In jedem längeren offline Termin wird zu Beginn eine Agenda mit Pausen kommuniziert. Warum sollte dies bei Online-Meetings anders sein? Kommuniziere heute Pausen in jedem Online-Meeting, das länger als eine Stunde dauert, und halte diese ein."
  },
  {
    "id": 11,
    "focus_area": "Effektive Remote Meetings",
    "title": "Experimente mit neuen Tools",
    "description": "Manche Dinge kann man besser remote erledigen - man kennt nur die Tools dazu nicht. Sei heute experimentierfreudig und recherchiere und verwende heute eine neues Tool in einem deiner Online-Meetings, z.B Mural.co."
  },
  {
    "id": 12,
    "focus_area": "Effektive Remote Meetings",
    "title": "Slack Nerd",
    "description": "Wenn man auf einmal im Home Office ist, ist man auf bestimmte Tools sehr viel mehr angewiesen als sont. Teste heute etwas Neues bei Slack - eine neue App, eine Integration, vielleicht ein spannender neuer Channel."
  },
  {
    "id": 13,
    "focus_area": "Trennung von Arbeit und Privatem",
    "title": "Spaziergänger:innen",
    "description": "Setze dir heute einen 20-minütigen Blocker in den Kalender, um heute einfach mal zwischendurch spazieren zu gehen."
  },
  {
    "id": 14,
    "focus_area": "Trennung von Arbeit und Privatem",
    "title": "Die Aktivpause",
    "description": "Setze dir heute einen 45-minütigen Blocker in den Kalender, um ein kurzes Workout einzulegen. Empfehlenswert sind dazu auch Apps wie Nike Training Club, Freeletics o.ä."
  },
  {
    "id": 15,
    "focus_area": "Trennung von Arbeit und Privatem",
    "title": "Bewusster Feierabend",
    "description": "Setze dir eine Deadline für den heutigen Feierabend. Die Uhrzeit spielt dabei eine untergeordnete Rolle, wichtig ist, dass du nach dieser Uhrzeit deine Arbeit beendest und auch keine Nachrichten mehr auf deinem Arbeitshandy liest oder beantwortest."
  },
  {
    "id": 16,
    "focus_area": "Kein Arbeitsweg = mehr Zeit",
    "title": "Bücherwurm",
    "description": "Nutze heute die Zeit, die du sonst zum Pendeln nutzt, um ein Buch zu lesen."
  },
  {
    "id": 17,
    "focus_area": "Kein Arbeitsweg = mehr Zeit",
    "title": "Zeit gespart",
    "description": "Berechne heute wie viel Pendelzeit du dieses Jahr bereits durch Homeoffice gespart hast. Ganz schön viel, oder?"
  },
  {
    "id": 18,
    "focus_area": "Networking 2.0",
    "title": "Network Revival",
    "description": "(Berufliche) soziale Netzwerke bieten ein großes Potential, doch oftmals verknüpft man sich über die Jahre mit vielen Menschen, mit denen man immer weniger Kontakt hat. Kontaktiere einen deiner Kontakte mit dem du schon länger nichts zu tun hattest. Die Effekte können überraschend sein - oftmals ergeben sich neue Anknüpfungspunkte, die zu einem früheren Zeitpunkt vielleicht nicht da waren."
  },
  {
    "id": 19,
    "focus_area": "Networking 2.0",
    "title": "Kaffee? Remote? Na klar!",
    "description": "Das Lunch mit dem Kunden, oder der Kaffee mit dem Partner - das sind wichtige Aktivitäten des beruflichen und sozialen Austauschs. Vereinbare einen digitalen Kaffee! Dafür musst du nicht mal viel Zeit aufbringen um zum besonderen Kaffee zu fahren. Zudem wird durch das heimische Umfeld eine noch lockerere Atmosphäre geschaffen!"
  },
  {
    "id": 20,
    "focus_area": "Networking 2.0",
    "title": "Meetup geht auch remote",
    "description": "Plane die Teilnahme an einem Remote Webinar oder Meetup. Nehme in den kommenden zwei Wochen daran teil."
  }
];

function storeDBEntry(id, item, callback) {
  item['userID'] = id;
  var dbParams = {
    TableName: userDBTable,
    Item: item
  };
  dynamoDb.put(dbParams, (error) => {
      callback(error)
  });
}


app.get('/', function (req, res) {

  res.send('Hello World!')

})

app.get('/oauth', function(req, ret) {
    const timestamp = new Date().getTime();
    var accessTockenURL = 'https://slack.com'
    var clientID = slackClientID;
    var client_secret = slackClientSecret;
    var authCode = req.query.code;

    console.log(req.query);
    
    var appState = JSON.parse(req.query.state);
    console.log(appState);

    var appRedirect = appState['redirect'];
    var appUser = appState['user'];


    var redirectURI = 'https://9pvgib8rn5.execute-api.eu-central-1.amazonaws.com/dev/oauth';
    var path = '/api/oauth.access?client_id=' + encodeURI(clientID);
    path += '&client_secret=' + encodeURI(client_secret);
    path += '&code=' + authCode;
    path += '&redirect_uri=' + encodeURI(redirectURI);
    
    var requ = https.get(accessTockenURL, {
      path: path
    }, function(res) {
      const { statusCode } = res;
      res.setEncoding('utf8');
      let rawData = '';
      res.on('data', (chunk) => { rawData += chunk; });
      res.on('end', () => {
        var decodedData = JSON.parse(rawData);
        putOrUpdateUserEntry(appUser, {
          slackID: decodedData['user_id'],
          accessToken: rawData,
          createdAt: timestamp,
          authCode: authCode
        }, (error) => {
          if (error) {
            ret.status(500).send('Oops, ' + error);
            return;
          }       
          if (appRedirect) {
            ret.redirect(appRedirect + "?slackRegistered=true");
          } else {
            ret.send('ok');
          }
        });
      });
    });
});

app.all('/register', (req, ret) => {
  var userID = req.query.userID;
  var password = req.query.password;
  if (!userID || !password) {
    ret.status(400).json({success:false, error:"malformed request"});
  }
  loadUserDBEnty(userID, (entry) => {
    if (entry) {
      ret.status(409).json({
        success: false,
        error: "User " + userID + " already exists."
      });
    } else {
      putOrUpdateUserEntry(userID, {
        password: password
      }, () => {
        ret.json({
          success: true,
          slackRegistered: false
        });
      });
    }
  });
});

function checkUserTBEntryForSlackAccessToken(entry) {
  try {
    var decoded = JSON.parse(entry['accessToken']);
    if (decoded['ok']) {
      return true;
    }
    return false;
  } catch (e) {
    return false;
  }
}

app.all('/login', (req, ret) => {
  var userID = req.query.userID;
  var password = req.query.password;
  if (!userID || !password) {
    ret.status(400).json({success:false, error:"malformed request"});
  }
  loadUserDBEnty(userID, (entry) => {
    var success = false;
    if (entry && entry['password'] == password) {
      success = true;
    }
    if (success) {
      ret.json({
        success: true,
        slackRegistered: checkUserTBEntryForSlackAccessToken(entry)
      });
    } else {
      ret.json({
        success: false,
      });
    }
  });
});

app.get('/write-task/:userID/:taskID', (req, ret) => {
  var userID = req.params.userID;
  var taskID = req.params.taskID;
  assignTask(userID, testTask[taskID], 3, (error) => {
    if (!error) {
      ret.send('OK');
      return;
    }
    ret.status('500').send(JSON.stringify(error));
  })
});

function removeActionsFromBlocks(blocksArr) {
  return blocksArr.filter(el => el['type'] != 'actions');
}

function crossoutTextSectionsFromBlocks(blocksArr) {
  try {
    blocksArr.forEach((el, idx) => {
      if (el['type'] == 'section' && el['text'] && el['text']['type'] == 'mrkdwn') {
        el['text']['text'] = '~' + el['text']['text'] + '~';
        blocksArr[idx] = el;
      }
    });
  } catch (e) {
  }
  return blocksArr;
}

function handleTaskDoneFromSlack(taskID, assignedAt, slackUserID, callback) {
  loadUserDBEntryBySlackID(slackUserID, (userEntry) => {
    if (!userEntry) {
      console.log('could not find user entry for '+ slackUserID)
      callback();
      return;
    }
    putOrUpdateUserTask(userEntry['userID'], {
      resolvedAt: new Date().getTime()
    }, assignedAt, taskID, (error) => {
      if (error) {
        console.log(JSON.stringify(error));
      }
      callback();
    });
  });
}

function handleTaskDeniedFromSlack(taskID, assignedAt, slackUserID, callback) {
  loadUserDBEntryBySlackID(slackUserID, (userEntry) => {
    if (!userEntry) {
      console.log('could not find user entry for '+ slackUserID)
      callback();
      return;
    }
    putOrUpdateUserTask(userEntry['userID'], {
      deniedAt: new Date().getTime()
    }, assignedAt, taskID, (error) => {
      if (error) {
        console.log(JSON.stringify(error));
      }
      callback();
    });
  });
}

function reactToTaskInteraction(interactionPayload, callback) {
  console.log(interactionPayload);
  var parsedPayload = JSON.parse(interactionPayload);
  var actionValue = parsedPayload['actions'][0]['value']; // we only expect one action
  var [selectedAction, taskID, taskNo, assignedAt] = actionValue.split('-');
  console.log(selectedAction);
  console.log(taskID);
  console.log(taskNo);
  var slackUserID = parsedPayload['user']['id'];
  var responseURL = parsedPayload['response_url'];

  var crossoutText = false;
  
  var afterHandlerCallback = () => {
    var blocks = removeActionsFromBlocks(parsedPayload['message']['blocks']);
    if (crossoutText) {
      blocks = crossoutTextSectionsFromBlocks(blocks);
    }
    var responsePayload = {
      replace_original: true,
      text: parsedPayload['message']['text'] + " ",
      blocks: blocks
    };
  
    request.post({
      uri: responseURL,
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify(responsePayload)
    }, callback);
  }; 

  switch(selectedAction) {
    case 'done':
      handleTaskDoneFromSlack(taskID, assignedAt, slackUserID, afterHandlerCallback);
      break;
    case 'deny':
      crossoutText = true;
      handleTaskDeniedFromSlack(taskID, assignedAt, slackUserID, afterHandlerCallback);
      break;
    default:
      afterHandlerCallback();
  }
}

// this is called by slack once an interactive element is clicked
app.post('/slack-interactivity-handler', bodyParser.urlencoded({extended: true}), bodyParser.json({type:'*/*'}), (req, ret) => {
  console.log(req);
  console.log("body");
  console.log(req.body);
  console.log("payload");
  console.log(req.body.payload);
  storeDBEntry(uuid.v1(), {
    request: JSON.stringify(req.body.payload)
  }, (error) => {
    if (error) {
      console.log("DB save error: ");
      console.log(error);
      ret.status(500).send(JSON.stringify(error));
    } else {
      reactToTaskInteraction(req.body.payload, () => {  
        ret.status(200).send("OK");
      });
    }
  });
});

app.get('/tasks/:userID', (req, ret) => {

  var userID = req.params.userID;
  var retData = [];
  loadUserTasks(userID, (items) => {
    items.forEach((el) => {
      var taskID = el['taskID'];
      var defaults = {
          "resolvedAt": null,
          "deniedAt": null
      };
      retData.push(Object.assign({}, defaults, testTask[taskID], el));
    });
    ret.json(retData);
  });
});

app.get('/all-tasks', (req, ret) => {
  ret.json(testTask);
});

app.get('/all-tasks/:area', (req, ret) => {
  var area = req.params.area.toLowerCase();
  ret.json(testTask.filter((el) => el['focus_area'].toLowerCase() == area));
});

app.get('/send-morning-messages/:userID', (req, ret) => {
  var userID = req.params.userID;

  var noChallanges = 3;

  if (!userID) {
    ret.status(400).send("Invalid request");
    return;
  }
  sendSlackMessage(userID, "Guten Morgen! Hier ein paar Challanges um den Home-Office-Tag interaktiv zu gestalten: ", () => {
    var drawnTaskIdxs = [];
    while (drawnTaskIdxs.length < noChallanges) {
      var randIdx = Math.round(Math.random() * (testTask.length - 1));
      if (drawnTaskIdxs.filter(el => el == randIdx).length == 0) {
        drawnTaskIdxs.push(randIdx);
      }
      console.log(drawnTaskIdxs);
    }

    var promisses = [];
    var sendTasks = [];

    drawnTaskIdxs.forEach((taskIdx, arrIdx) => {
      sendTasks.push(testTask[taskIdx]);
      promisses.push(
        new Promise((resolve, reject) => { assignTask(userID, testTask[taskIdx],arrIdx + 1, () => resolve()) })
      );
    });
    Promise.all(promisses).then(() => {
      ret.json({success:true, sendTasks: sendTasks});
    });
  });
  
});


module.exports.handler = serverless(app);
