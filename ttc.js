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

//== Header
printDefaultHeader();

//== Twitter OAuth Config (/config/twitter.js)
try{
  var tw_config = require('./config/twitter').tokens;
  var  consumer = oauth.createConsumer(tw_config.CONSUMER_KEY, tw_config.CONSUMER_SECRET)
      ,token = oauth.createToken(tw_config.OAUTH_TOKEN, tw_config.OAUTH_TOKEN_SECRET)
      ,signer = oauth.createHmac(consumer, token)
      ,client = oauth.createClient(config.API_PORT_SSL, config.API_URL , true);
}catch(e){
  console.log('TIP: You can raise the API calls limit by setting up your Twitter OAuth tokens. Edit the file /config/twitter-example.js and save it as /config/twitter.js\n')
  client = http.createClient(config.API_PORT, config.API_URL , false);
}

//== Variables
var  response_formats = ['json', 'xml'] //json output sometimes stop working, so we check both
    ,trends_request = {'xml':{},'json':{}}
    ,current_trends = {'xml':{},'json':{}}
    ,last_trends = {'as_of': 0, 'trends': [] }
    ,invalid_syntax = false
    ,options_callbacks = [];

//== Default options
var options = { 'woeid' : '1'}

//= Command Line Options
arguments.parse([
     {'name': /^(-h|--help)$/, 'expected': null, 'callback': printHelp}
    ,{'name': /^(-l|--location)$/, 'expected': /^([A-Za-z]{2}|[0-9]+)$/, 'callback': changeLocation}
    ,{'name': /^(-o|--output-file)$/, 'expected': /./, 'callback': changeOutput}
  ], main, invalidArgument);

//== Manual
function printHelp(){
  var country_codes = [];
  for(code in config.KNOWN_COUNTRY_CODES){
    country_codes.push(code +' - '+config.KNOWN_WOEIDS[config.KNOWN_COUNTRY_CODES[code]]);
  }
  var woeids = [];
  for(woeid in config.KNOWN_WOEIDS){
    woeids.push(woeid +' - '+config.KNOWN_WOEIDS[woeid]);
  }
  var help_text = '\
Usage:\
\n\tnode '+ __filename.substring(__dirname.length+1, __filename.length) +' [option value] [option value]…\
\n\
\nOptions:\
\n\t-l/--location:\
\n\t\tDefault value: '+options['woeid']+'\
\n\t\tTwo letter country code or the woeid code for the location you want.\
\n\
\n\t\tThe currently supported country codes are:\n\t\t\t'+ country_codes.join('\n\t\t\t') +'\
\n\
\n\t\tSome known woeid codes:\n\t\t\t'+ woeids.join('\n\t\t\t') +'\
\n\
\n\t\tFor an up-to-date list of locations provided by Twitter, access:\
\n\t\t\tcurl http://api.twitter.com/1/trends/available.xml\
\n\
\nAuthor:\
\n\tFabricio Campos Zuardi\
\n\tTwitter: @fczuardi\
\n\tWebsite: http://fabricio.org\
\n\
\nContributions:\
\n\t'+config.SCRIPT_NAME+' is a Free Software released under the MIT License, which\
\n\tmeans that you are welcome to copy, study and modify this software and, why not,\
\n\teven contribute with improvements and bug fixes!\
\n\
\n\tThe code is hosted at '+config.SCRIPT_SOURCE_CODE_URL+'\
\n\
\nThanks for using it! :)\
\n\n';
   
  printAndExit(help_text, 0);
}

//== Default Header
function printDefaultHeader(){
  console.log(config.SCRIPT_TITLE);
  if (process.argv.length == 2){
    console.log('Check the HELP page: node '+ __filename.substring(__dirname.length+1, __filename.length) +' -h\n');
  }
}

//= Functions

//== main()
function main(){
  getCurrentTrends('xml');
  // getCurrentTrends('json');
};

//== changeLocation()
function changeLocation(end, location){
  options.woeid = (config.KNOWN_COUNTRY_CODES[location])?(config.KNOWN_COUNTRY_CODES[location]):location;
  end();
}

function changeOutput(end, file_path){
  // console.log('changeOutput:'+file_path);
  end();
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
    if (response.statusCode != 200) { return responseError(response, 'error', 'Request failed.', '8309740116819739'); }
    if (response.headers["x-ratelimit-remaining"] < 100) { responseError(response, 'warning', 'We are reaching the limit!!', ('7925415213685483')) }
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
      console.log(as_of+' so skip');
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
  output += 'Trending Topics (as of '+ as_of_date.toLocaleString() +')\nLocation: '+ config.KNOWN_WOEIDS[options['woeid']] +'\n\n'
  for (i=0;i<content['trends'].length;i++){
    output += (i+1) + '. ' + entitiesToChar(content['trends'][i]['name']) + ' - ' + content['trends'][i]['url'] +'\n';
  }
  output += '\n('+ content['remaining_calls'] +' API calls remaining)\n\n';
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
  console.log('Error: the argument %s %s', arg, (value_missing?'expects a value':'is not valid.'))
}

//== responseError()
function responseError(response, type, msg, code){
  console.log('== %s: %s (%s) ==', type.toUpperCase(), msg, code);
  console.log(response.statusCode);
  console.log(response.headers);
  return false;
}

//== responseContentError()
function responseContentError(result, type, msg, code){
  console.log('== %s: %s (%s) ==', type.toUpperCase(), msg, code);
  if (type == 'error') {
    console.log(result);
  }
  return false;
}