'use strict';

//  ---------------------------------------------------------------------------

const Exchange = require ('./base/Exchange');
const { AuthenticationError, ExchangeError, InvalidOrder, InsufficientFunds, OrderNotFound } = require ('./base/errors');

//  ---------------------------------------------------------------------------

module.exports = class tradesatoshi extends Exchange {
    describe () {
        return this.deepExtend (super.describe (), {
            'id': 'tradesatoshi',
            'name': 'TradeSatoshi',
            'countries': [ 'UK' ], // ?
            'version': '*',
            'rateLimit': 1500,
            'hasCORS': false,
            // new metainfo interface
            'has': {
                'privateAPI': true,
                'fetchTickers': true,
                'fetchOHLCV': true,
                'fetchOrder': true,
                'fetchOrders': true,
                'fetchOpenOrders': true,
                'fetchMyTrades': false,
                'fetchCurrencies': true,
                'withdraw': true,
            },
            'timeframes': {
                '1m': 'oneMin',
                '5m': 'fiveMin',
                '30m': 'thirtyMin',
                '1h': 'hour',
                '1d': 'day',
            },
            'urls': {
                'logo': 'https://user-images.githubusercontent.com/1294454/44006686-f96c02ce-9e90-11e8-871c-c67d21e9d165.jpg',
                'api': 'https://tradesatoshi.com/api',
                'www': 'https://tradesatoshi.com/',
                'doc': 'https://tradesatoshi.com/Home/Api',
                'fees': 'https://tradesatoshi.com/FeesStructure',
            },
            'api': {
                'public': {
                    'get': [
                        'getcurrencies',
                        'getticker',
                        'getmarkethistory',
                        'getmarketsummary',
                        'getmarketsummaries',
                        'getorderbook',
                    ],
                },
                'private': {
                    'post': [
                        'getbalance',
                        'getbalances',
                        'getorder',
                        'getorders',
                        'submitorder',
                        'cancelorder',
                        'gettradehistory',
                        'generateaddress',
                        'submitwithdraw',
                        'getdeposits',
                        'getwithdrawals',
                        'submittransfer',
                    ],
                },
            },
        });
    }

    async fetchMarkets () {
        let response = await this.publicGetGetmarketsummaries ();
        const log = require ('ololog').unlimited;
        log (response);
        process.exit ();
        let result = [];
        for (let i = 0; i < response['result'].length; i++) {
            let market = response['result'][i]['Market'];
            let id = market['MarketName'];
            let base = market['MarketCurrency'];
            let quote = market['BaseCurrency'];
            base = this.commonCurrencyCode (base);
            quote = this.commonCurrencyCode (quote);
            let symbol = base + '/' + quote;
            let precision = {
                'amount': 8,
                'price': 8,
            };
            let amountLimits = {
                'min': market['MinTradeSize'],
                'max': undefined,
            };
            let priceLimits = { 'min': undefined, 'max': undefined };
            let limits = {
                'amount': amountLimits,
                'price': priceLimits,
            };
            let active = market['IsActive'];
            result.push (this.extend (this.fees['trading'], {
                'id': id,
                'symbol': symbol,
                'base': base,
                'quote': quote,
                'active': active,
                'info': market,
                'lot': Math.pow (10, -precision['amount']),
                'precision': precision,
                'limits': limits,
            }));
        }
        return result;
    }

    async fetchBalance (params = {}) {
        await this.loadMarkets ();
        let response = await this.accountGetBalances ();
        let balances = response['result'];
        let result = { 'info': balances };
        let indexed = this.indexBy (balances, 'Currency');
        let keys = Object.keys (indexed);
        for (let i = 0; i < keys.length; i++) {
            let id = keys[i];
            let currency = this.commonCurrencyCode (id);
            let account = this.account ();
            let balance = indexed[id];
            let free = parseFloat (balance['Available']);
            let total = parseFloat (balance['Balance']);
            let used = total - free;
            account['free'] = free;
            account['used'] = used;
            account['total'] = total;
            result[currency] = account;
        }
        return this.parseBalance (result);
    }

    async fetchOrderBook (symbol, params = {}) {
        await this.loadMarkets ();
        let response = await this.publicGetOrderbook (this.extend ({
            'market': this.marketId (symbol),
            'type': 'both',
            'depth': 50,
        }, params));
        let orderbook = response['result'];
        return this.parseOrderBook (orderbook, undefined, 'buy', 'sell', 'Rate', 'Quantity');
    }

    parseTicker (ticker, market = undefined) {
        let timestamp = this.parse8601 (ticker['TimeStamp']);
        let symbol = undefined;
        if (market)
            symbol = market['symbol'];
        return {
            'symbol': symbol,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'high': this.safeFloat (ticker, 'High'),
            'low': this.safeFloat (ticker, 'Low'),
            'bid': this.safeFloat (ticker, 'Bid'),
            'ask': this.safeFloat (ticker, 'Ask'),
            'vwap': undefined,
            'open': undefined,
            'close': undefined,
            'first': undefined,
            'last': this.safeFloat (ticker, 'Last'),
            'change': undefined,
            'percentage': undefined,
            'average': undefined,
            'baseVolume': this.safeFloat (ticker, 'Volume'),
            'quoteVolume': this.safeFloat (ticker, 'BaseVolume'),
            'info': ticker,
        };
    }

    async fetchCurrencies (params = {}) {
        let response = await this.publicGetCurrencies (params);
        let currencies = response['result'];
        let result = {};
        for (let i = 0; i < currencies.length; i++) {
            let currency = currencies[i];
            let id = currency['Currency'];
            // todo: will need to rethink the fees
            // to add support for multiple withdrawal/deposit methods and
            // differentiated fees for each particular method
            let code = this.commonCurrencyCode (id);
            let precision = 8; // default precision, todo: fix "magic constants"
            result[code] = {
                'id': id,
                'code': code,
                'info': currency,
                'name': currency['CurrencyLong'],
                'active': currency['IsActive'],
                'status': 'ok',
                'fee': currency['TxFee'], // todo: redesign
                'precision': precision,
                'limits': {
                    'amount': {
                        'min': Math.pow (10, -precision),
                        'max': Math.pow (10, precision),
                    },
                    'price': {
                        'min': Math.pow (10, -precision),
                        'max': Math.pow (10, precision),
                    },
                    'cost': {
                        'min': undefined,
                        'max': undefined,
                    },
                    'withdraw': {
                        'min': currency['TxFee'],
                        'max': Math.pow (10, precision),
                    },
                },
            };
        }
        return result;
    }

    async fetchTickers (symbols = undefined, params = {}) {
        await this.loadMarkets ();
        let response = await this.publicGetMarketsummaries (params);
        let tickers = response['result'];
        let result = {};
        for (let t = 0; t < tickers.length; t++) {
            let ticker = tickers[t];
            let id = ticker['MarketName'];
            let market = undefined;
            let symbol = id;
            if (id in this.markets_by_id) {
                market = this.markets_by_id[id];
                symbol = market['symbol'];
            } else {
                let [ quote, base ] = id.split ('-');
                base = this.commonCurrencyCode (base);
                quote = this.commonCurrencyCode (quote);
                symbol = base + '/' + quote;
            }
            result[symbol] = this.parseTicker (ticker, market);
        }
        return result;
    }

    async fetchTicker (symbol, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetMarketsummary (this.extend ({
            'market': market['id'],
        }, params));
        let ticker = response['result'][0];
        return this.parseTicker (ticker, market);
    }

    parseTrade (trade, market = undefined) {
        let timestamp = this.parse8601 (trade['TimeStamp']);
        let side = undefined;
        if (trade['OrderType'] === 'BUY') {
            side = 'buy';
        } else if (trade['OrderType'] === 'SELL') {
            side = 'sell';
        }
        let id = undefined;
        if ('Id' in trade)
            id = trade['Id'].toString ();
        return {
            'id': id,
            'info': trade,
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': market['symbol'],
            'type': 'limit',
            'side': side,
            'price': trade['Price'],
            'amount': trade['Quantity'],
        };
    }

    async fetchTrades (symbol, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let response = await this.publicGetMarkethistory (this.extend ({
            'market': market['id'],
        }, params));
        if ('result' in response) {
            if (typeof response['result'] !== 'undefined')
                return this.parseTrades (response['result'], market, since, limit);
        }
        throw new ExchangeError (this.id + ' fetchTrades() returned undefined response');
    }

    parseOHLCV (ohlcv, market = undefined, timeframe = '1d', since = undefined, limit = undefined) {
        let timestamp = this.parse8601 (ohlcv['T']);
        return [
            timestamp,
            ohlcv['O'],
            ohlcv['H'],
            ohlcv['L'],
            ohlcv['C'],
            ohlcv['V'],
        ];
    }

    async fetchOHLCV (symbol, timeframe = '1m', since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let request = {
            'tickInterval': this.timeframes[timeframe],
            'marketName': market['id'],
        };
        let response = await this.v2GetMarketGetTicks (this.extend (request, params));
        return this.parseOHLCVs (response['result'], market, timeframe, since, limit);
    }

    async fetchOpenOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {};
        let market = undefined;
        if (symbol) {
            market = this.market (symbol);
            request['market'] = market['id'];
        }
        let response = await this.marketGetOpenorders (this.extend (request, params));
        let orders = this.parseOrders (response['result'], market);
        return this.filterOrdersBySymbol (orders, symbol);
    }

    async createOrder (symbol, type, side, amount, price = undefined, params = {}) {
        await this.loadMarkets ();
        let market = this.market (symbol);
        let method = 'marketGet' + this.capitalize (side) + type;
        let order = {
            'market': market['id'],
            'quantity': this.amountToPrecision (symbol, amount),
        };
        if (type === 'limit')
            order['rate'] = this.priceToPrecision (symbol, price);
        let response = await this[method] (this.extend (order, params));
        let result = {
            'info': response,
            'id': response['result']['uuid'],
        };
        return result;
    }

    async cancelOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let response = undefined;
        try {
            response = await this.marketGetCancel (this.extend ({
                'uuid': id,
            }, params));
        } catch (e) {
            if (this.last_json_response) {
                let message = this.safeString (this.last_json_response, 'message');
                if (message === 'ORDER_NOT_OPEN')
                    throw new InvalidOrder (this.id + ' cancelOrder() error: ' + this.last_http_response);
                if (message === 'UUID_INVALID')
                    throw new OrderNotFound (this.id + ' cancelOrder() error: ' + this.last_http_response);
            }
            throw e;
        }
        return response;
    }

    parseOrder (order, market = undefined) {
        let side = undefined;
        if ('OrderType' in order)
            side = (order['OrderType'] === 'LIMIT_BUY') ? 'buy' : 'sell';
        if ('Type' in order)
            side = (order['Type'] === 'LIMIT_BUY') ? 'buy' : 'sell';
        let status = 'open';
        if (order['Closed']) {
            status = 'closed';
        } else if (order['CancelInitiated']) {
            status = 'canceled';
        }
        let symbol = undefined;
        if (!market) {
            if ('Exchange' in order)
                if (order['Exchange'] in this.markets_by_id)
                    market = this.markets_by_id[order['Exchange']];
        }
        if (market)
            symbol = market['symbol'];
        let timestamp = undefined;
        if ('Opened' in order)
            timestamp = this.parse8601 (order['Opened']);
        if ('TimeStamp' in order)
            timestamp = this.parse8601 (order['TimeStamp']);
        let fee = undefined;
        let commission = undefined;
        if ('Commission' in order) {
            commission = 'Commission';
        } else if ('CommissionPaid' in order) {
            commission = 'CommissionPaid';
        }
        if (commission) {
            fee = {
                'cost': parseFloat (order[commission]),
                'currency': market['quote'],
            };
        }
        let price = this.safeFloat (order, 'Limit');
        let cost = this.safeFloat (order, 'Price');
        let amount = this.safeFloat (order, 'Quantity');
        let remaining = this.safeFloat (order, 'QuantityRemaining', 0.0);
        let filled = amount - remaining;
        if (!cost) {
            if (price && amount)
                cost = price * amount;
        }
        if (!price) {
            if (cost && filled)
                price = cost / filled;
        }
        let average = this.safeFloat (order, 'PricePerUnit');
        let result = {
            'info': order,
            'id': order['OrderUuid'],
            'timestamp': timestamp,
            'datetime': this.iso8601 (timestamp),
            'symbol': symbol,
            'type': 'limit',
            'side': side,
            'price': price,
            'cost': cost,
            'average': average,
            'amount': amount,
            'filled': filled,
            'remaining': remaining,
            'status': status,
            'fee': fee,
        };
        return result;
    }

    async fetchOrder (id, symbol = undefined, params = {}) {
        await this.loadMarkets ();
        let response = undefined;
        try {
            response = await this.accountGetOrder ({ 'uuid': id });
        } catch (e) {
            if (this.last_json_response) {
                let message = this.safeString (this.last_json_response, 'message');
                if (message === 'UUID_INVALID')
                    throw new OrderNotFound (this.id + ' fetchOrder() error: ' + this.last_http_response);
            }
            throw e;
        }
        return this.parseOrder (response['result']);
    }

    async fetchOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        await this.loadMarkets ();
        let request = {};
        let market = undefined;
        if (symbol) {
            market = this.market (symbol);
            request['market'] = market['id'];
        }
        let response = await this.accountGetOrderhistory (this.extend (request, params));
        let orders = this.parseOrders (response['result'], market);
        return this.filterOrdersBySymbol (orders, symbol);
    }

    async fetchClosedOrders (symbol = undefined, since = undefined, limit = undefined, params = {}) {
        let orders = await this.fetchOrders (symbol, params);
        return this.filterBy (orders, 'status', 'closed');
    }

    currencyId (currency) {
        if (currency === 'BCH')
            return 'BCC';
        return currency;
    }

    async fetchDepositAddress (currency, params = {}) {
        let currencyId = this.currencyId (currency);
        let response = await this.accountGetDepositaddress (this.extend ({
            'currency': currencyId,
        }, params));
        let address = this.safeString (response['result'], 'Address');
        let message = this.safeString (response, 'message');
        let status = 'ok';
        if (!address || message === 'ADDRESS_GENERATING')
            status = 'pending';
        return {
            'currency': currency,
            'address': address,
            'status': status,
            'info': response,
        };
    }

    async withdraw (currency, amount, address, params = {}) {
        let currencyId = this.currencyId (currency);
        let response = await this.accountGetWithdraw (this.extend ({
            'currency': currencyId,
            'quantity': amount,
            'address': address,
        }, params));
        let id = undefined;
        if ('result' in response) {
            if ('uuid' in response['result'])
                id = response['result']['uuid'];
        }
        return {
            'info': response,
            'id': id,
        };
    }

    sign (path, api = 'public', method = 'GET', params = {}, headers = undefined, body = undefined) {
        let url = this.urls['api'] + '/' + api + '/' + this.implodeParams (path, params);
        let query = this.omit (params, this.extractParams (path));
        if (api === 'public') {
            if (Object.keys (query).length)
                url += '?' + this.urlencode (query);
        } else {
            this.checkRequiredCredentials ();
            let nonce = this.nonce ();
            url += api + '/';
            if (((api === 'account') && (path !== 'withdraw')) || (path === 'openorders'))
                url += method.toLowerCase ();
            url += path + '?' + this.urlencode (this.extend ({
                'nonce': nonce,
                'apikey': this.apiKey,
            }, params));
            let signature = this.hmac (this.encode (url), this.encode (this.secret), 'sha512');
            headers = { 'apisign': signature };
        }
        return { 'url': url, 'method': method, 'body': body, 'headers': headers };
    }

    handleErrors (code, reason, url, method, headers, body) {
        if (code >= 400) {
            if (body[0] === '{') {
                let response = JSON.parse (body);
                if ('success' in response) {
                    if (!response['success']) {
                        if ('message' in response) {
                            if (response['message'] === 'MIN_TRADE_REQUIREMENT_NOT_MET')
                                throw new InvalidOrder (this.id + ' ' + this.json (response));
                            if (response['message'] === 'APIKEY_INVALID')
                                throw new AuthenticationError (this.id + ' ' + this.json (response));
                        }
                        throw new ExchangeError (this.id + ' ' + this.json (response));
                    }
                }
            }
        }
    }
};
