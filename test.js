const {Resend}=require('resend');
const r=new Resend(process.env.RESEND_API_KEY);
r.emails.send({from:'onboarding@resend.dev',to:'tnhu5006@gmail.com',subject:'Test',html:'test'}).then(console.log).catch(console.error)