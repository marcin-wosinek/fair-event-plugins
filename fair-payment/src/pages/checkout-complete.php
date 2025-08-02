<?php
/**
 * Checkout complete page placeholder for Fair Payment plugin
 *
 * @package FairPayment
 */

// Exit if accessed directly
if (!defined('ABSPATH')) {
    exit;
}

get_header(); ?>

<div class="fair-payment-checkout-complete">
    <div class="container">
        <h1><?php esc_html_e('Payment Complete', 'fair-payment'); ?></h1>

        <div class="checkout-complete-content">
            <div class="success-message">
                <p><?php esc_html_e('Thank you for your payment! Your transaction has been completed successfully.', 'fair-payment'); ?></p>
            </div>

            <div class="order-details-placeholder">
                <h2><?php esc_html_e('Order Details', 'fair-payment'); ?></h2>
                <p><?php esc_html_e('Payment confirmation and order details will be displayed here.', 'fair-payment'); ?></p>
            </div>

            <div class="next-steps-placeholder">
                <h2><?php esc_html_e('What\'s Next?', 'fair-payment'); ?></h2>
                <p><?php esc_html_e('Information about next steps and additional actions will be shown here.', 'fair-payment'); ?></p>
            </div>

            <div class="actions">
                <a href="<?php echo esc_url(home_url()); ?>" class="button">
                    <?php esc_html_e('Return to Home', 'fair-payment'); ?>
                </a>
            </div>
        </div>
    </div>
</div>

<?php get_footer();
