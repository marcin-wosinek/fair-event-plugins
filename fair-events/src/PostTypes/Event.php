<?php
/**
 * Event Post Type
 *
 * @package FairEvents
 */

namespace FairEvents\PostTypes;

use FairEvents\Settings\Settings;

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

		// Get slug from settings, fallback to default
		$slug = get_option( 'fair_events_slug', 'fair-events' );

		$args = array(
			'labels'             => $labels,
			'public'             => true,
			'publicly_queryable' => true,
			'show_ui'            => true,
			'show_in_menu'       => true,
			'query_var'          => true,
			'rewrite'            => array( 'slug' => $slug ),
			'capability_type'    => 'post',
			'has_archive'        => true,
			'hierarchical'       => false,
			'menu_position'      => 20,
			'menu_icon'          => 'dashicons-calendar-alt',
			'supports'           => array( 'title', 'editor', 'author', 'thumbnail', 'excerpt', 'custom-fields' ),
			'show_in_rest'       => true,
			'taxonomies'         => array( 'category', 'post_tag' ),
		);

		register_post_type( self::POST_TYPE, $args );

		self::register_meta();
		self::register_meta_box();
		self::register_clone_support();
		self::register_admin_columns();
	}

	/**
	 * Register custom meta fields for all enabled post types
	 *
	 * Only registers event_location (legacy, used by CalendarButtonHooks as fallback).
	 * Event dates are now stored exclusively in the fair_event_dates custom table.
	 *
	 * @return void
	 */
	public static function register_meta() {
		$enabled_post_types = Settings::get_enabled_post_types();

		foreach ( $enabled_post_types as $post_type ) {
			register_post_meta(
				$post_type,
				'event_location',
				array(
					'type'              => 'string',
					'description'       => __( 'Event location', 'fair-events' ),
					'single'            => true,
					'show_in_rest'      => true,
					'sanitize_callback' => 'sanitize_text_field',
					'default'           => '',
				)
			);
		}
	}

	/**
	 * Register meta box for event details
	 *
	 * @return void
	 */
	public static function register_meta_box() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_meta_box_scripts' ) );
	}

	/**
	 * Enqueue meta box scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public static function enqueue_meta_box_scripts( $hook ) {
		// Only load on post edit screens.
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}

		$screen = get_current_screen();
		if ( ! $screen ) {
			return;
		}

		// Check if current post type is in enabled post types.
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! in_array( $screen->post_type, $enabled_post_types, true ) ) {
			return;
		}

		$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/event-meta-box/index.asset.php';

		wp_enqueue_script(
			'fair-events-event-meta-box',
			FAIR_EVENTS_PLUGIN_URL . 'build/admin/event-meta-box/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);

		wp_enqueue_style( 'wp-components' );

		// Pass event date info to JS.
		global $post;
		$event_date_id    = 0;
		$manage_event_url = '';
		$post_id          = $post ? $post->ID : 0;
		if ( $post ) {
			$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post->ID );
			if ( $event_dates ) {
				$event_date_id    = $event_dates->id;
				$manage_event_url = admin_url( 'admin.php?page=fair-events-manage-event&event_date_id=' . $event_dates->id );
			}
		}

		wp_localize_script(
			'fair-events-event-meta-box',
			'fairEventsMetaBox',
			array(
				'postId'         => $post_id,
				'postType'       => $screen->post_type,
				'eventDateId'    => $event_date_id,
				'manageEventUrl' => $manage_event_url,
			)
		);

		wp_set_script_translations(
			'fair-events-event-meta-box',
			'fair-events',
			FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
		);
	}

	/**
	 * Add meta box for event details to all enabled post types
	 *
	 * @return void
	 */
	public static function add_meta_box() {
		$enabled_post_types = Settings::get_enabled_post_types();

		foreach ( $enabled_post_types as $post_type ) {
			add_meta_box(
				'fair_event_details',
				__( 'Event Details', 'fair-events' ),
				array( __CLASS__, 'render_meta_box' ),
				$post_type,
				'side',
				'default'
			);
		}
	}

	/**
	 * Render meta box content
	 *
	 * Renders a React mount point. The React component handles all UI and saves via REST API.
	 *
	 * @param \WP_Post $post The post object.
	 * @return void
	 */
	public static function render_meta_box( $post ) {
		?>
		<div id="fair-events-meta-box-root">
			<p><?php esc_html_e( 'Loading...', 'fair-events' ); ?></p>
		</div>
		<?php
	}

	/**
	 * Register support for copy-delete-posts plugin
	 *
	 * @return void
	 */
	public static function register_clone_support() {
		// Support copy-delete-posts plugin by ensuring event meta is copied
		// Hook very late after metadata has been set
		add_action( 'added_post_meta', array( __CLASS__, 'copy_event_meta_on_cdp_origin' ), 10, 4 );
	}

	/**
	 * Copy event metadata when _cdp_origin is set (indicates cloning)
	 *
	 * @param int    $meta_id    ID of metadata entry.
	 * @param int    $post_id    Post ID.
	 * @param string $meta_key   Meta key.
	 * @param mixed  $meta_value Meta value.
	 * @return void
	 */
	public static function copy_event_meta_on_cdp_origin( $meta_id, $post_id, $meta_key, $meta_value ) {
		// Only act when _cdp_origin is set (copy-delete-posts marker)
		if ( $meta_key !== '_cdp_origin' ) {
			return;
		}

		// Check if this post type is enabled for events
		$post = get_post( $post_id );
		if ( ! $post ) {
			return;
		}

		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! in_array( $post->post_type, $enabled_post_types, true ) ) {
			return;
		}

		// $meta_value contains the original post ID
		$origin_id = $meta_value;

		// Check if origin post exists
		$origin_post = get_post( $origin_id );
		if ( ! $origin_post ) {
			return;
		}

		// Copy event data from original post's custom table row.
		$event_dates    = \FairEvents\Models\EventDates::get_by_event_id( $origin_id );
		$event_location = get_post_meta( $origin_id, 'event_location', true );

		if ( $event_dates ) {
			\FairEvents\Models\EventDates::save(
				$post_id,
				$event_dates->start_datetime,
				$event_dates->end_datetime,
				$event_dates->all_day
			);

			// Copy venue from custom table.
			if ( $event_dates->venue_id ) {
				$new_event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
				if ( $new_event_dates ) {
					\FairEvents\Models\EventDates::update_by_id( $new_event_dates->id, array( 'venue_id' => $event_dates->venue_id ) );
				}
			}

			// Add to junction table.
			$new_event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
			if ( $new_event_dates ) {
				\FairEvents\Models\EventDates::add_linked_post( $new_event_dates->id, $post_id );
			}
		}
		if ( $event_location ) {
			update_post_meta( $post_id, 'event_location', $event_location );
		}
	}

	/**
	 * Register admin columns for all enabled post types
	 *
	 * @return void
	 */
	public static function register_admin_columns() {
		$enabled_post_types = Settings::get_enabled_post_types();

		foreach ( $enabled_post_types as $post_type ) {
			add_filter( 'manage_' . $post_type . '_posts_columns', array( __CLASS__, 'add_admin_columns' ) );
			add_action( 'manage_' . $post_type . '_posts_custom_column', array( __CLASS__, 'render_admin_column' ), 10, 2 );
			add_filter( 'manage_edit-' . $post_type . '_sortable_columns', array( __CLASS__, 'add_sortable_columns' ) );
		}

		add_action( 'pre_get_posts', array( __CLASS__, 'handle_column_sorting' ) );
		add_filter( 'post_row_actions', array( __CLASS__, 'add_rsvp_row_action' ), 10, 2 );
	}

	/**
	 * Add custom columns to admin list
	 *
	 * @param array $columns Existing columns.
	 * @return array Modified columns.
	 */
	public static function add_admin_columns( $columns ) {
		// Insert event columns after title
		$new_columns = array();
		foreach ( $columns as $key => $value ) {
			$new_columns[ $key ] = $value;
			if ( $key === 'title' ) {
				$new_columns['event_datetime'] = __( 'Date & Time', 'fair-events' );
			}
		}
		return $new_columns;
	}

	/**
	 * Render custom column content
	 *
	 * @param string $column  Column name.
	 * @param int    $post_id Post ID.
	 * @return void
	 */
	public static function render_admin_column( $column, $post_id ) {
		if ( 'event_datetime' === $column ) {
			$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
			if ( $event_dates && $event_dates->start_datetime ) {
				$start = self::format_event_datetime( $event_dates->start_datetime, $event_dates->all_day );
				$end   = $event_dates->end_datetime ? self::format_event_datetime( $event_dates->end_datetime, $event_dates->all_day ) : '';

				if ( $end && $end !== $start ) {
					echo esc_html( $start . ' – ' . $end );
				} else {
					echo esc_html( $start );
				}
			} else {
				echo '—';
			}
		}
	}

	/**
	 * Format event datetime for display
	 *
	 * @param string $datetime Datetime string.
	 * @param bool   $all_day  Whether event is all-day.
	 * @return string Formatted datetime.
	 */
	private static function format_event_datetime( $datetime, $all_day = false ) {
		if ( empty( $datetime ) ) {
			return '';
		}

		$timestamp = strtotime( $datetime );
		if ( false === $timestamp ) {
			return $datetime;
		}

		$date_format = get_option( 'date_format' );

		if ( $all_day ) {
			// All-day events: show date only
			return wp_date( $date_format, $timestamp );
		} else {
			// Timed events: show date and time
			$time_format = get_option( 'time_format' );
			return wp_date( $date_format . ' ' . $time_format, $timestamp );
		}
	}

	/**
	 * Make event columns sortable
	 *
	 * @param array $columns Sortable columns.
	 * @return array Modified sortable columns.
	 */
	public static function add_sortable_columns( $columns ) {
		$columns['event_datetime'] = 'event_datetime';
		return $columns;
	}

	/**
	 * Handle sorting by event date/time via custom table JOIN
	 *
	 * @param \WP_Query $query The query object.
	 * @return void
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 */
	public static function handle_column_sorting( $query ) {
		if ( ! is_admin() || ! $query->is_main_query() ) {
			return;
		}

		$orderby = $query->get( 'orderby' );

		if ( 'event_datetime' === $orderby ) {
			add_filter( 'posts_clauses', array( __CLASS__, 'sort_by_event_date_clauses' ), 10, 2 );
		}
	}

	/**
	 * Modify query clauses to sort by event start datetime from custom table
	 *
	 * @param array     $clauses Query clauses.
	 * @param \WP_Query $query   The query object.
	 * @return array Modified clauses.
	 *
	 * phpcs:disable WordPress.DB.DirectDatabaseQuery
	 */
	public static function sort_by_event_date_clauses( $clauses, $query ) {
		global $wpdb;

		$table_name  = $wpdb->prefix . 'fair_event_dates';
		$posts_table = $wpdb->prefix . 'fair_event_date_posts';

		// LEFT JOIN via direct event_id OR junction table.
		$clauses['join'] .= " LEFT JOIN {$table_name} AS fed ON ({$wpdb->posts}.ID = fed.event_id AND fed.occurrence_type IN ('single', 'master'))";
		$clauses['join'] .= " LEFT JOIN {$posts_table} AS fedp ON {$wpdb->posts}.ID = fedp.post_id";
		$clauses['join'] .= " LEFT JOIN {$table_name} AS fed2 ON (fedp.event_date_id = fed2.id AND fed2.occurrence_type IN ('single', 'master'))";

		$order = $query->get( 'order' ) ?: 'ASC';
		$order = strtoupper( $order ) === 'DESC' ? 'DESC' : 'ASC';

		$clauses['orderby'] = "COALESCE(fed.start_datetime, fed2.start_datetime) {$order}";

		// Remove this filter after first use to avoid affecting other queries.
		remove_filter( 'posts_clauses', array( __CLASS__, 'sort_by_event_date_clauses' ), 10 );

		return $clauses;
	}

	/**
	 * Add custom row actions (Copy, RSVP, etc.)
	 *
	 * @param array    $actions Existing row actions.
	 * @param \WP_Post $post    The post object.
	 * @return array Modified row actions.
	 */
	public static function add_rsvp_row_action( $actions, $post ) {
		// Only add for enabled post types
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! in_array( $post->post_type, $enabled_post_types, true ) ) {
			return $actions;
		}

		// Only show Copy action for fair_event post type
		if ( self::POST_TYPE === $post->post_type ) {
			$copy_url        = wp_nonce_url(
				admin_url( 'admin.php?page=fair-events-copy&event_id=' . $post->ID ),
				'copy_fair_event_' . $post->ID
			);
			$actions['copy'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url( $copy_url ),
				esc_html__( 'Copy', 'fair-events' )
			);
		}

		// Only add RSVP link if fair-rsvp plugin is active
		if ( defined( 'FAIR_RSVP_PLUGIN_DIR' ) ) {
			// Add confirm attendance link
			$url                           = admin_url( 'admin.php?page=fair-rsvp-attendance&event_id=' . $post->ID );
			$actions['confirm_attendance'] = sprintf(
				'<a href="%s">%s</a>',
				esc_url( $url ),
				esc_html__( 'Confirm Attendance', 'fair-events' )
			);
		}

		return $actions;
	}
}
