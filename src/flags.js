const RAW_COUNTRY_DATA = `
AF|Afghanistan
AX|Aland Islands
AL|Albania
DZ|Algeria
AS|American Samoa
AD|Andorra
AO|Angola
AI|Anguilla
AQ|Antarctica
AG|Antigua and Barbuda
AR|Argentina
AM|Armenia
AW|Aruba
AU|Australia
AT|Austria
AZ|Azerbaijan
BS|Bahamas
BH|Bahrain
BD|Bangladesh
BB|Barbados
BY|Belarus
BE|Belgium
BZ|Belize
BJ|Benin
BM|Bermuda
BT|Bhutan
BO|Bolivia
BQ|Caribbean Netherlands
BA|Bosnia and Herzegovina
BW|Botswana
BV|Bouvet Island
BR|Brazil
IO|British Indian Ocean Territory
BN|Brunei
BG|Bulgaria
BF|Burkina Faso
BI|Burundi
CV|Cabo Verde
KH|Cambodia
CM|Cameroon
CA|Canada
KY|Cayman Islands
CF|Central African Republic
TD|Chad
CL|Chile
CN|China
CX|Christmas Island
CC|Cocos Keeling Islands
CO|Colombia
KM|Comoros
CD|Congo DR
CG|Congo Republic
CK|Cook Islands
CR|Costa Rica
CI|Cote d'Ivoire
HR|Croatia
CU|Cuba
CW|Curacao
CY|Cyprus
CZ|Czechia
DK|Denmark
DJ|Djibouti
DM|Dominica
DO|Dominican Republic
EC|Ecuador
EG|Egypt
SV|El Salvador
GQ|Equatorial Guinea
ER|Eritrea
EE|Estonia
ET|Ethiopia
FK|Falkland Islands
FO|Faroe Islands
FJ|Fiji
FI|Finland
FR|France
GF|French Guiana
PF|French Polynesia
TF|French Southern Territories
GA|Gabon
GM|Gambia
GE|Georgia
DE|Germany
GH|Ghana
GI|Gibraltar
GR|Greece
GL|Greenland
GD|Grenada
GP|Guadeloupe
GU|Guam
GT|Guatemala
GG|Guernsey
GN|Guinea
GW|Guinea-Bissau
GY|Guyana
HT|Haiti
HM|Heard and McDonald Islands
VA|Holy See
HN|Honduras
HK|Hong Kong
HU|Hungary
IS|Iceland
IN|India
ID|Indonesia
IR|Iran
IQ|Iraq
IE|Ireland
IM|Isle of Man
IL|Israel
IT|Italy
JM|Jamaica
JP|Japan
JE|Jersey
JO|Jordan
KZ|Kazakhstan
KE|Kenya
KI|Kiribati
KP|North Korea
KR|South Korea
KW|Kuwait
KG|Kyrgyzstan
LA|Laos
LV|Latvia
LB|Lebanon
LS|Lesotho
LR|Liberia
LY|Libya
LI|Liechtenstein
LT|Lithuania
LU|Luxembourg
MO|Macao
MK|North Macedonia
MG|Madagascar
MW|Malawi
MY|Malaysia
MV|Maldives
ML|Mali
MT|Malta
MH|Marshall Islands
MQ|Martinique
MR|Mauritania
MU|Mauritius
YT|Mayotte
MX|Mexico
FM|Micronesia
MD|Moldova
MC|Monaco
MN|Mongolia
ME|Montenegro
MS|Montserrat
MA|Morocco
MZ|Mozambique
MM|Myanmar
NA|Namibia
NR|Nauru
NP|Nepal
NL|Netherlands
NC|New Caledonia
NZ|New Zealand
NI|Nicaragua
NE|Niger
NG|Nigeria
NU|Niue
NF|Norfolk Island
MP|Northern Mariana Islands
NO|Norway
OM|Oman
PK|Pakistan
PW|Palau
PS|Palestine
PA|Panama
PG|Papua New Guinea
PY|Paraguay
PE|Peru
PH|Philippines
PN|Pitcairn Islands
PL|Poland
PT|Portugal
PR|Puerto Rico
QA|Qatar
RE|Reunion
RO|Romania
RU|Russia
RW|Rwanda
BL|Saint Barthelemy
SH|Saint Helena
KN|Saint Kitts and Nevis
LC|Saint Lucia
MF|Saint Martin
PM|Saint Pierre and Miquelon
VC|Saint Vincent and the Grenadines
WS|Samoa
SM|San Marino
ST|Sao Tome and Principe
SA|Saudi Arabia
SN|Senegal
RS|Serbia
SC|Seychelles
SL|Sierra Leone
SG|Singapore
SX|Sint Maarten
SK|Slovakia
SI|Slovenia
SB|Solomon Islands
SO|Somalia
ZA|South Africa
GS|South Georgia and Sandwich Islands
SS|South Sudan
ES|Spain
LK|Sri Lanka
SD|Sudan
SR|Suriname
SJ|Svalbard and Jan Mayen
SE|Sweden
CH|Switzerland
SY|Syria
TW|Taiwan
TJ|Tajikistan
TZ|Tanzania
TH|Thailand
TL|Timor-Leste
TG|Togo
TK|Tokelau
TO|Tonga
TT|Trinidad and Tobago
TN|Tunisia
TR|Turkey
TM|Turkmenistan
TC|Turks and Caicos Islands
TV|Tuvalu
UG|Uganda
UA|Ukraine
AE|United Arab Emirates
GB|United Kingdom
US|United States
UM|United States Outlying Islands
UY|Uruguay
UZ|Uzbekistan
VU|Vanuatu
VE|Venezuela
VN|Vietnam
VG|British Virgin Islands
VI|U.S. Virgin Islands
WF|Wallis and Futuna
EH|Western Sahara
YE|Yemen
ZM|Zambia
ZW|Zimbabwe
`;

const CHAR_CODE_OFFSET = 0x1f1e6;
const ASCII_A = 65;

function isoCodeToEmoji(code) {
  if (!code || code.length !== 2) {
    return '';
  }
  const upper = code.toUpperCase();
  const first = upper.charCodeAt(0) - ASCII_A;
  const second = upper.charCodeAt(1) - ASCII_A;
  if (first < 0 || first > 25 || second < 0 || second > 25) {
    return '';
  }
  return String.fromCodePoint(CHAR_CODE_OFFSET + first) + String.fromCodePoint(CHAR_CODE_OFFSET + second);
}

const MEME_FLAGS = [
  { code: 'PRIDE', name: 'Rainbow Pride Flag', emoji: '🏳️‍🌈' },
  { code: 'TRANS', name: 'Transgender Flag', emoji: '🏳️‍⚧️' },
  { code: 'BI', name: 'Bisexual Flag', emoji: '💗💜💙' },
  { code: 'PAN', name: 'Pansexual Flag', emoji: '💗💛💙' },
  { code: 'NB', name: 'Nonbinary Flag', emoji: '💛🤍💜🖤' },
  { code: 'ACE', name: 'Asexual Flag', emoji: '⬛⬜🟪⬜' },
  { code: 'ALLY', name: 'Straight Ally Flag', emoji: '⬛⬜🏳️‍🌈⬜⬛' },
  { code: 'NAZI', name: 'Swastika (Nazi Symbol)', emoji: '卐' },
  { code: 'NAZI_ALT', name: 'Swastika (Alternative)', emoji: '卍' },
  { code: 'KEK', name: 'Kekistan Flag', emoji: '🟢⚫⚪' },
  { code: 'JEW', name: 'Star of David', emoji: '✡️' },
  { code: 'ISLAM', name: 'Star and Crescent', emoji: '☪️' },
  { code: 'CHRIST', name: 'Christian Cross', emoji: '✝️' }
];

export const FLAG_EMOJI_OPTIONS = RAW_COUNTRY_DATA.trim()
  .split('\n')
  .map((line) => {
    const [code, name] = line.split('|');
    return {
      code,
      name,
      emoji: isoCodeToEmoji(code)
    };
  })
  .concat(MEME_FLAGS)
  .filter((item) => item.emoji);
