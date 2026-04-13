<?php
/**
 * Admin bar link to manage linked event from frontend
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Adds a "Manage Event" node to the admin bar on singular frontend pages
 * that are linked to an event date.
 */
class AdminBarHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_action( 'admin_bar_menu', array( $this, 'add_manage_event_node' ), 80 );
	}

	/**
	 * Add "Manage Event" node to the admin bar
	 *
	 * @param \WP_Admin_Bar $wp_admin_bar Admin bar instance.
	 * @return void
	 */
	public function add_manage_event_node( $wp_admin_bar ) {
		if ( is_admin() || ! is_singular() ) {
			return;
		}

		if ( ! current_user_can( 'edit_posts' ) ) {
			return;
		}

		$post_id       = get_the_ID();
		$post_type     = get_post_type( $post_id );
		$enabled_types = Settings::get_enabled_post_types();

		if ( ! in_array( $post_type, $enabled_types, true ) ) {
			return;
		}

		$event_date = EventDates::get_by_event_id( $post_id );
		if ( ! $event_date ) {
			return;
		}

		$wp_admin_bar->add_node(
			array(
				'id'    => 'fair-events-manage-event',
				'title' => __( 'Manage Event', 'fair-events' ),
				'href'  => admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . (int) $event_date->id ),
			)
		);
	}
}
