require('dotenv').config();

const express =
  require('express');

const cors =
  require('cors');

const paymentRoutes =
  require('./routes/payment');

const app = express();

app.use(cors());

app.use(express.json());

app.use(
  '/',
  paymentRoutes
);

const PORT =
  process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    `Server running on ${PORT}`
  );
});