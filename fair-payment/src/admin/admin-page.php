<?php
/**
 * Admin page for Fair Event Plugins
 *
 * @package FairPayment
 */

namespace FairPayment\Admin;

/**
 * Register the admin menu
 */
function register_admin_menu() {
	add_menu_page(
		'Fair Event Plugins',
		'Fair Event Plugins',
		'manage_options',
		'fair-event-plugins',
		__NAMESPACE__ . '\render_admin_page',
		'dashicons-calendar-alt',
		30
	);
}

/**
 * Render the admin page
 */
function render_admin_page() {
	?>
	<div class="wrap">
		<h1><?php echo esc_html( get_admin_page_title() ); ?></h1>
		<div class="card">
			<h2>Welcome to Fair Event Plugins</h2>
			<p>This is a collection of plugins for event organization with fair pricing models.</p>
			<p>Hello World! The admin page is working correctly.</p>
		</div>
	</div>
	<?php
}
