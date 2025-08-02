<?php
/**
 * Routing functionality for Fair Payment plugin
 *
 * @package FairPayment
 */

namespace FairPayment\Routing;

// Exit if accessed directly
if (!defined('ABSPATH')) {
    exit;
}

/**
 * Initialize routing hooks
 */
function init_routing() {
    add_action('init', __NAMESPACE__ . '\add_rewrite_rules');
    add_filter('query_vars', __NAMESPACE__ . '\add_query_vars');
    add_action('template_redirect', __NAMESPACE__ . '\handle_template_redirect');
    
    // Flush rewrite rules on activation
    register_activation_hook(__FILE__, __NAMESPACE__ . '\flush_rewrite_rules');
}

/**
 * Add custom rewrite rules for Fair Payment pages
 */
function add_rewrite_rules() {
    add_rewrite_rule(
        '^fair-checkout/?$',
        'index.php?fair_page=checkout',
        'top'
    );
    
    add_rewrite_rule(
        '^fair-checkout-complete/?$',
        'index.php?fair_page=checkout-complete',
        'top'
    );
}

/**
 * Add custom query variables
 *
 * @param array $vars Existing query variables
 * @return array Modified query variables
 */
function add_query_vars($vars) {
    $vars[] = 'fair_page';
    return $vars;
}

/**
 * Handle template redirect for Fair Payment pages
 */
function handle_template_redirect() {
    $fair_page = get_query_var('fair_page');
    
    if (!$fair_page) {
        return;
    }
    
    switch ($fair_page) {
        case 'checkout':
            load_checkout_page();
            break;
        case 'checkout-complete':
            load_checkout_complete_page();
            break;
        default:
            // Invalid fair_page, return 404
            global $wp_query;
            $wp_query->set_404();
            status_header(404);
            return;
    }
}

/**
 * Load the checkout page template
 */
function load_checkout_page() {
    $template_path = plugin_dir_path(dirname(__FILE__)) . 'src/pages/checkout.php';
    
    if (file_exists($template_path)) {
        include $template_path;
        exit;
    }
    
    // Fallback if template not found
    wp_die(esc_html__('Checkout page not found.', 'fair-payment'), 404);
}

/**
 * Load the checkout complete page template
 */
function load_checkout_complete_page() {
    $template_path = plugin_dir_path(dirname(__FILE__)) . 'src/pages/checkout-complete.php';
    
    if (file_exists($template_path)) {
        include $template_path;
        exit;
    }
    
    // Fallback if template not found
    wp_die(esc_html__('Checkout complete page not found.', 'fair-payment'), 404);
}

/**
 * Flush rewrite rules (typically called on plugin activation)
 */
function flush_rewrite_rules() {
    add_rewrite_rules();
    flush_rewrite_rules();
}