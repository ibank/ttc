/*
Trending Topics Client - command line tool to get trending topics from Twitter

Copyright (c) 2010 Fabricio Campos Zuardi

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
*/

//= Globals

//== Libraries
var  sys = require('sys')
    ,http = require('http')
    ,arguments = require('./lib/node-arguments')
    ,oauth = require('./lib/node-oauth/lib/oauth')
    ,config = require('./config/setup');

//== Variables
var  response_formats = ['json', 'xml'] //json output sometimes stop working, so we check both
    ,trends_request = {'xml':{},'json':{}}
    ,current_trends = {'xml':{},'json':{}}
    ,last_trends = {'as_of': 0, 'trends': [] }
    ,options = config.options;

//== Twitter OAuth Config (/config/twitter.js)
try{
  var tw_config = require('./config/twitter').tokens;
  var  consumer = oauth.createConsumer(tw_config.CONSUMER_KEY, tw_config.CONSUMER_SECRET)
      ,token = oauth.createToken(tw_config.OAUTH_TOKEN, tw_config.OAUTH_TOKEN_SECRET)
      ,signer = oauth.createHmac(consumer, token)
      ,client = oauth.createClient(config.API_PORT_SSL, config.API_URL , true);
}catch(e){
  client = http.createClient(config.API_PORT, config.API_URL , false);
}

//= Command Line Options
arguments.parse([
     {'name': /^(-h|--help)$/, 'expected': null, 'callback': printHelp}
    ,{'name': /^(--version)$/, 'expected': null, 'callback': printVersion}
    ,{'name': /^(-l|--location)$/, 'expected': /^([A-Za-z]{2}|[0-9]+)$/, 'callback': changeLocation}
    ,{'name': /^(-f|--format)$/, 'expected': /^(normal|names|json|debug)$/, 'callback': changeFormat}
  ], main, invalidArgument);

//== printHelp()
function printHelp(){
  printDefaultHeader();
  printAndExit(config.HELP_TEXT, 0);
}

//== printVersion()
function printVersion(){
  printAndExit(config.VERSION+'\n', 0);
}

//== changeLocation()
function changeLocation(end, location){
  var l = location.toLowerCase();
  if ((l.match(/^([A-Za-z]{2})$/)) && (!config.KNOWN_COUNTRY_CODES[l])) { 
    invalidArgument(location, false);
    return false
  };
  options.woeid = (config.KNOWN_COUNTRY_CODES[l])?(config.KNOWN_COUNTRY_CODES[l]):location;
  end();
}

//== changeFormat()
function changeFormat(end, fmt){
  options.output_format = fmt;
  end();
}

//= Main
function main(){
  if (config.options.output_format.match(/^(normal|debug)$/)) { printDefaultHeader();}
  getCurrentTrends('xml');
  // getCurrentTrends('json');
};

//= Functions

//== printDefaultHeader()
function printDefaultHeader(){
  console.log(config.SCRIPT_TITLE);
  if (process.argv.length == 2){
    console.log('Check the HELP page: node '+ __filename.substring(__dirname.length+1, __filename.length) +' -h\n');
  }
}

//== getCurrentTrends()
function getCurrentTrends(fmt){
  current_trends[fmt] = {'as_of': 0, 'body': '', 'remaining_calls': 0, 'trends': []}
  if (tw_config){
    trends_request[fmt] = client.request('GET', config.LOCAL_TRENDS_PATH + options['woeid'] + '.' + fmt, null, null, signer);
  } else {
    trends_request[fmt] = client.request('GET', config.LOCAL_TRENDS_PATH + options['woeid'] + '.' + fmt, {'host': config.API_URL});
  }
  trends_request[fmt].addListener('response', function(response) {
    var response_type = (response.headers['content-type'].indexOf('xml') != -1) ? 'xml' :
                        ((response.headers['content-type'].indexOf('json') != -1) ? 'json' : 'other')
    response.setEncoding('utf8');
    // error handling
    if (response.statusCode != 200) { return responseError(response, 'error', 'Request failed. Time:'+(new Date().toLocaleString()), '8309740116819739'); }
    if (response.headers["x-ratelimit-remaining"] < 20) { responseError(response, 'warning', 'We are reaching the limit!!', ('7925415213685483')) }
    if (response_type == 'other') { return responseError(response, 'error', 'Wrong MIME Type.', '20324136363342404'); }
    current_trends[fmt]['remaining_calls'] = response.headers["x-ratelimit-remaining"];
    // what to do when data comes in
    if (response_type == 'xml'){
      parseTrendsXML(response);
    }else {
      parseTrendsJSON(response);
    }
  });
  trends_request[fmt].end(); //make the request
}

//== parseTrendsXML()
function parseTrendsXML(response) {
  response.addListener('data', function (chunk) {
    current_trends['xml']['body'] += chunk;
  });
  response.addListener('end', function () {
    var as_of_re = /as_of="([^"]*)"/gim;
    var as_of_matches = as_of_re.exec(current_trends['xml']['body']);
    var as_of = Date.parse(as_of_matches[1]);
    if (as_of <= last_trends['as_of']){ 
      if (config.options.output_format.match(/^(debug)$/)) { 
        console.log(as_of+' so skip');
      }
      return false
    }
    //<trend query="Ursinhos+Carinhosos" url="http://search.twitter.com/search?q=Ursinhos+Carinhosos">Ursinhos Carinhosos</trend>
    var trend_re = /<trend[^>]*>[^<]*<\/trend>/gim;
    var trend_matches = current_trends['xml']['body'].match(trend_re);
    var trend_data_re = /<trend\s*query="([^"]*)"\surl="([^"]*)"[^>]*>([^<]*)<\/trend>/i;
    if (!trend_matches) { return responseContentError(current_trends['xml']['body'], 'error', 'XML contains no trends.', '5253734595607966');}
    for (i=0;i<trend_matches.length;i++){
      var trend_data_matches = trend_data_re.exec(trend_matches[i]);
      current_trends['xml']['trends'].push({
         'name': trend_data_matches[3]
        ,'query': trend_data_matches[1]
        ,'url': trend_data_matches[2]
        });
    }
    current_trends['xml']['as_of'] = as_of;
    last_trends = current_trends['xml'];
    trendsParsed(current_trends['xml']);
  });
}

//== parseTrendsJSON()
function parseTrendsJSON(response){
  response.addListener('data', function (chunk) {
    current_trends['json']['body'] += chunk;
  });
  response.addListener('end', function () {
    //error handling
    try{
      result = JSON.parse(current_trends['json']['body'])[0];
    }catch(e){
      return responseContentError(result, 'error', 'Could not parse JSON.', '05745784239843488');
    }
    if (!result['as_of']){ return responseContentError(result, 'error', 'Response doesn’t have timestamp.', '9761156134773046'); }
    var as_of = Date.parse(result['as_of'])
    if (as_of <= last_trends['as_of']){ return responseContentError(result, 'info', 'The result we have is newer than this one, skip it.', '3963864736724645'); }
    if (!result['trends']){ return responseContentError(result, 'error', 'Response doesn’t have trends list.', '8779761055484414'); }
    if (result['trends'].length == 0){ return responseContentError(result, 'error', 'Response trends list is empty.', '6612175547052175'); }
    //build ranking
    for (i=0;i<result['trends'].length;i++){
      current_trends['json']['trends'].push(result['trends'][i]);
    }
    current_trends['json']['as_of'] = as_of;
    last_trends = current_trends['json'];
    trendsParsed(current_trends['json']);
  });
}

//== trendsParsed()
function trendsParsed(content){
  var as_of_date = new Date(content['as_of']);
  var output = '';
  var fmt = config.options.output_format;
  var normal_or_debug = fmt.match(/^(normal|debug)$/);
  switch (fmt){
    case 'json':
      delete content['body'];
      output = JSON.stringify(content);
      break;
    default:
      // output += normal_or_debug?('\n'):'';
      for (i=0;i<content['trends'].length;i++){
        output += normal_or_debug?((i+1) + '. '):'';
        output += entitiesToChar(content['trends'][i]['name']);
        output += normal_or_debug?(' - ' + content['trends'][i]['url']):'';
        output += '\n';
      }
      if (normal_or_debug){
        output += '\n';
        output += 'Location: '+ config.KNOWN_WOEIDS[options['woeid']]+'\n'
        output += 'Time: '+as_of_date.toLocaleString() +')\n'
        output += 'API calls remaining: '+content['remaining_calls']+'\n';
      }
  }
  output += '\n';
  printAndExit(output, 0);
  return true;
}

//= Helpers

//== printAndExit()
function printAndExit(msg, exitcode){
  exitcode = (exitcode == undefined) ? 0 : exitcode;
  process.stdout.end(msg);
  process.stdout.addListener('close', function(){
    process.exit(exitcode);
  });
}

//== entitiesToChar()
function entitiesToChar(text){
  // Convert Decimal numeric character references ex: &#195; to Ã
  text = text.replace(/&#([0-9]{1,7});/g, function(match, submatch) { return String.fromCharCode(submatch);} );
  return text;
}

//== invalidArgument()
function invalidArgument(arg, value_missing){
  printAndExit('Error: the argument '+arg+' '+(value_missing?'expects a value':'is not valid.')+'\n', 1);
}

//== responseError()
function responseError(response, type, msg, code){
  var output = '== '+type.toUpperCase()+': '+msg+' ('+code+') ==';
  output += '\n\n'+response.statusCode;
  output += '\n\n'+JSON.stringify(response.headers)+'\n';
  if (type == 'error'){
    printAndExit(output, 1);
  } else {
    if (config.options.output_format.match(/^(debug|normal)$/)){
      console.log(output);
    }
  }
  return false;
}

//== responseContentError()
function responseContentError(result, type, msg, code){
  var output = '== '+type.toUpperCase()+': '+msg+' ('+code+') ==\n'
  if (type == 'error') {
    output += result+'\n'
  }
  printAndExit(output, 1);
  return false;
}