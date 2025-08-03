<?php
require_once 'vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$stripeSecretKey = $_ENV['STRIPE_SECRET_KEY'];
?>
