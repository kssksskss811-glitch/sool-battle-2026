/* One-time display-only exception. Never writes closing prices or history. */
(() => {
  "use strict";
  const override=Object.freeze({
    symbol:"GOOGL",price:291.70,currency:"USD",
    referenceClose:Object.freeze({price:324.89,date:"2026-10-28"}),
    recordedAt:"2026-10-29T09:32:23Z",specifiedAt:null,asOf:null
  });
  function validDay(day){
    if(typeof day!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(day))return false;
    const date=new Date(day+"T00:00:00Z");
    return Number.isFinite(+date)&&date.toISOString().slice(0,10)===day;
  }
  function apply(data){
    const quote=data?.markets?.[override.symbol];
    if(!quote||data.locked)return data;
    const regularClose=(!quote.priceType&&!quote.asOf)||(quote.priceType==="previous_close"&&quote.session==="regular");
    if(regularClose&&Number.isFinite(quote.price)&&quote.price>0&&validDay(quote.date)&&quote.date>override.referenceClose.date)return data;
    return {...data,markets:{...data.markets,[override.symbol]:{
      price:override.price,currency:override.currency,priceType:"user_override",
      date:null,asOf:null,source:"사용자 지정",stale:false,userOverride:override
    }}};
  }
  const api={apply,override};
  if(typeof module!=="undefined"&&module.exports)module.exports=api;else globalThis.UserPriceOverride=api;
})();
