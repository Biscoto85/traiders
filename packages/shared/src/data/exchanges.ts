/**
 * Known EODHD exchange codes with metadata.
 * Used for configuration and display.
 */
export const KNOWN_EXCHANGES = [
  // North America
  { code: "US", name: "US Stocks (NYSE, NASDAQ, AMEX)", country: "USA", currency: "USD" },
  { code: "TO", name: "Toronto Stock Exchange", country: "Canada", currency: "CAD" },
  { code: "V", name: "TSX Venture Exchange", country: "Canada", currency: "CAD" },
  { code: "MX", name: "Mexican Stock Exchange", country: "Mexico", currency: "MXN" },

  // Europe
  { code: "PA", name: "Euronext Paris", country: "France", currency: "EUR" },
  { code: "AS", name: "Euronext Amsterdam", country: "Netherlands", currency: "EUR" },
  { code: "BR", name: "Euronext Brussels", country: "Belgium", currency: "EUR" },
  { code: "LI", name: "Euronext Lisbon", country: "Portugal", currency: "EUR" },
  { code: "LSE", name: "London Stock Exchange", country: "UK", currency: "GBP" },
  { code: "XETRA", name: "Deutsche Börse XETRA", country: "Germany", currency: "EUR" },
  { code: "F", name: "Frankfurt Stock Exchange", country: "Germany", currency: "EUR" },
  { code: "MI", name: "Borsa Italiana (Milan)", country: "Italy", currency: "EUR" },
  { code: "MC", name: "Bolsa de Madrid", country: "Spain", currency: "EUR" },
  { code: "SW", name: "SIX Swiss Exchange", country: "Switzerland", currency: "CHF" },
  { code: "VI", name: "Vienna Stock Exchange", country: "Austria", currency: "EUR" },
  { code: "OL", name: "Oslo Stock Exchange", country: "Norway", currency: "NOK" },
  { code: "ST", name: "Stockholm (Nasdaq Nordic)", country: "Sweden", currency: "SEK" },
  { code: "CO", name: "Copenhagen (Nasdaq Nordic)", country: "Denmark", currency: "DKK" },
  { code: "HE", name: "Helsinki (Nasdaq Nordic)", country: "Finland", currency: "EUR" },
  { code: "WAR", name: "Warsaw Stock Exchange", country: "Poland", currency: "PLN" },
  { code: "AT", name: "Athens Stock Exchange", country: "Greece", currency: "EUR" },
  { code: "IS", name: "Borsa Istanbul", country: "Turkey", currency: "TRY" },

  // Asia-Pacific
  { code: "TSE", name: "Tokyo Stock Exchange", country: "Japan", currency: "JPY" },
  { code: "HKEX", name: "Hong Kong Stock Exchange", country: "Hong Kong", currency: "HKD" },
  { code: "SHG", name: "Shanghai Stock Exchange", country: "China", currency: "CNY" },
  { code: "SHE", name: "Shenzhen Stock Exchange", country: "China", currency: "CNY" },
  { code: "KO", name: "Korea Stock Exchange", country: "South Korea", currency: "KRW" },
  { code: "TW", name: "Taiwan Stock Exchange", country: "Taiwan", currency: "TWD" },
  { code: "BSE", name: "Bombay Stock Exchange", country: "India", currency: "INR" },
  { code: "NSE", name: "National Stock Exchange India", country: "India", currency: "INR" },
  { code: "AU", name: "Australian Securities Exchange", country: "Australia", currency: "AUD" },
  { code: "NZ", name: "New Zealand Exchange", country: "New Zealand", currency: "NZD" },
  { code: "SG", name: "Singapore Exchange", country: "Singapore", currency: "SGD" },
  { code: "BK", name: "Stock Exchange of Thailand", country: "Thailand", currency: "THB" },
  { code: "JK", name: "Indonesia Stock Exchange", country: "Indonesia", currency: "IDR" },
  { code: "KL", name: "Bursa Malaysia", country: "Malaysia", currency: "MYR" },

  // Middle East / Africa
  { code: "TA", name: "Tel Aviv Stock Exchange", country: "Israel", currency: "ILS" },
  { code: "SAU", name: "Saudi Stock Exchange (Tadawul)", country: "Saudi Arabia", currency: "SAR" },
  { code: "JSE", name: "Johannesburg Stock Exchange", country: "South Africa", currency: "ZAR" },

  // South America
  { code: "SA", name: "B3 São Paulo", country: "Brazil", currency: "BRL" },
  { code: "SN", name: "Santiago Stock Exchange", country: "Chile", currency: "CLP" },
  { code: "BA", name: "Buenos Aires Stock Exchange", country: "Argentina", currency: "ARS" },
] as const;

export type ExchangeCode = (typeof KNOWN_EXCHANGES)[number]["code"];
