<?php
/**
 * Event Post Type
 *
 * @package FairEvents
 */

namespace FairEvents\PostTypes;

defined( 'WPINC' ) || die;

/**
 * Event custom post type
 */
class Event {
	/**
	 * Post type slug
	 *
	 * @var string
	 */
	const POST_TYPE = 'fair_event';

	/**
	 * Register the Event post type
	 *
	 * @return void
	 */
	public static function register() {
		$labels = array(
			'name'                  => _x( 'Events', 'Post type general name', 'fair-events' ),
			'singular_name'         => _x( 'Event', 'Post type singular name', 'fair-events' ),
			'menu_name'             => _x( 'Events', 'Admin Menu text', 'fair-events' ),
			'name_admin_bar'        => _x( 'Event', 'Add New on Toolbar', 'fair-events' ),
			'add_new'               => __( 'Add New', 'fair-events' ),
			'add_new_item'          => __( 'Add New Event', 'fair-events' ),
			'new_item'              => __( 'New Event', 'fair-events' ),
			'edit_item'             => __( 'Edit Event', 'fair-events' ),
			'view_item'             => __( 'View Event', 'fair-events' ),
			'all_items'             => __( 'All Events', 'fair-events' ),
			'search_items'          => __( 'Search Events', 'fair-events' ),
			'parent_item_colon'     => __( 'Parent Events:', 'fair-events' ),
			'not_found'             => __( 'No events found.', 'fair-events' ),
			'not_found_in_trash'    => __( 'No events found in Trash.', 'fair-events' ),
			'featured_image'        => _x( 'Event Image', 'Overrides the "Featured Image" phrase', 'fair-events' ),
			'set_featured_image'    => _x( 'Set event image', 'Overrides the "Set featured image" phrase', 'fair-events' ),
			'remove_featured_image' => _x( 'Remove event image', 'Overrides the "Remove featured image" phrase', 'fair-events' ),
			'use_featured_image'    => _x( 'Use as event image', 'Overrides the "Use as featured image" phrase', 'fair-events' ),
			'archives'              => _x( 'Event archives', 'The post type archive label', 'fair-events' ),
			'insert_into_item'      => _x( 'Insert into event', 'Overrides the "Insert into post" phrase', 'fair-events' ),
			'uploaded_to_this_item' => _x( 'Uploaded to this event', 'Overrides the "Uploaded to this post" phrase', 'fair-events' ),
			'filter_items_list'     => _x( 'Filter events list', 'Screen reader text for the filter links', 'fair-events' ),
			'items_list_navigation' => _x( 'Events list navigation', 'Screen reader text for the pagination', 'fair-events' ),
			'items_list'            => _x( 'Events list', 'Screen reader text for the items list', 'fair-events' ),
		);

		$args = array(
			'labels'             => $labels,
			'public'             => true,
			'publicly_queryable' => true,
			'show_ui'            => true,
			'show_in_menu'       => true,
			'query_var'          => true,
			'rewrite'            => array( 'slug' => 'events' ),
			'capability_type'    => 'post',
			'has_archive'        => true,
			'hierarchical'       => false,
			'menu_position'      => 20,
			'menu_icon'          => 'dashicons-calendar-alt',
			'supports'           => array( 'title', 'editor', 'thumbnail', 'excerpt', 'custom-fields' ),
			'show_in_rest'       => true,
		);

		register_post_type( self::POST_TYPE, $args );

		self::register_meta();
	}

	/**
	 * Register custom meta fields for Event post type
	 *
	 * @return void
	 */
	public static function register_meta() {
		register_post_meta(
			self::POST_TYPE,
			'event_start',
			array(
				'type'              => 'string',
				'description'       => __( 'Event start date and time', 'fair-events' ),
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_text_field',
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'event_end',
			array(
				'type'              => 'string',
				'description'       => __( 'Event end date and time', 'fair-events' ),
				'single'            => true,
				'show_in_rest'      => true,
				'sanitize_callback' => 'sanitize_text_field',
			)
		);

		register_post_meta(
			self::POST_TYPE,
			'event_all_day',
			array(
				'type'         => 'boolean',
				'description'  => __( 'Whether the event is an all-day event', 'fair-events' ),
				'single'       => true,
				'show_in_rest' => true,
				'default'      => false,
			)
		);
	}
}
