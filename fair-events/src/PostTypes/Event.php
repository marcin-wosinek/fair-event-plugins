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

		register_post_meta(
			self::POST_TYPE,
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

	/**
	 * Register meta box for event details
	 *
	 * @return void
	 */
	public static function register_meta_box() {
		add_action( 'add_meta_boxes', array( __CLASS__, 'add_meta_box' ) );
		add_action( 'save_post', array( __CLASS__, 'save_meta_box' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue_meta_box_scripts' ) );
	}

	/**
	 * Enqueue meta box scripts
	 *
	 * @param string $hook Current admin page hook.
	 * @return void
	 */
	public static function enqueue_meta_box_scripts( $hook ) {
		// Only load on post edit screens for fair_event post type.
		if ( ! in_array( $hook, array( 'post.php', 'post-new.php' ), true ) ) {
			return;
		}

		$screen = get_current_screen();
		if ( ! $screen || self::POST_TYPE !== $screen->post_type ) {
			return;
		}

		$asset_file = include FAIR_EVENTS_PLUGIN_DIR . 'build/admin/event-meta/index.asset.php';

		wp_enqueue_script(
			'fair-events-event-meta',
			FAIR_EVENTS_PLUGIN_URL . 'build/admin/event-meta/index.js',
			$asset_file['dependencies'],
			$asset_file['version'],
			true
		);
	}

	/**
	 * Add meta box for event details
	 *
	 * @return void
	 */
	public static function add_meta_box() {
		add_meta_box(
			'fair_event_details',
			__( 'Event Details', 'fair-events' ),
			array( __CLASS__, 'render_meta_box' ),
			self::POST_TYPE,
			'side',
			'default'
		);
	}

	/**
	 * Render meta box content
	 *
	 * @param \WP_Post $post The post object.
	 * @return void
	 */
	public static function render_meta_box( $post ) {
		wp_nonce_field( 'fair_event_meta_box', 'fair_event_meta_box_nonce' );

		$event_start    = get_post_meta( $post->ID, 'event_start', true );
		$event_end      = get_post_meta( $post->ID, 'event_end', true );
		$event_all_day  = get_post_meta( $post->ID, 'event_all_day', true );
		$event_location = get_post_meta( $post->ID, 'event_location', true );

		// Determine input type based on all-day setting
		$input_type = $event_all_day ? 'date' : 'datetime-local';

		// Extract date portion if all-day event
		if ( $event_all_day ) {
			if ( $event_start && strpos( $event_start, 'T' ) !== false ) {
				$event_start = substr( $event_start, 0, strpos( $event_start, 'T' ) );
			}
			if ( $event_end && strpos( $event_end, 'T' ) !== false ) {
				$event_end = substr( $event_end, 0, strpos( $event_end, 'T' ) );
			}
		}
		?>
		<p>
			<label for="event_start">
				<?php esc_html_e( 'Start Date & Time', 'fair-events' ); ?>
			</label>
			<input
				type="<?php echo esc_attr( $input_type ); ?>"
				id="event_start"
				name="event_start"
				value="<?php echo esc_attr( $event_start ); ?>"
				style="width: 100%;"
			/>
		</p>
		<p>
			<label for="event_end">
				<?php esc_html_e( 'End Date & Time', 'fair-events' ); ?>
			</label>
			<input
				type="<?php echo esc_attr( $input_type ); ?>"
				id="event_end"
				name="event_end"
				value="<?php echo esc_attr( $event_end ); ?>"
				style="width: 100%;"
			/>
		</p>
		<p>
			<label for="event_all_day">
				<input
					type="checkbox"
					id="event_all_day"
					name="event_all_day"
					value="1"
					<?php checked( $event_all_day, true ); ?>
				/>
				<?php esc_html_e( 'All Day Event', 'fair-events' ); ?>
			</label>
		</p>
		<p>
			<label for="event_location">
				<?php esc_html_e( 'Location', 'fair-events' ); ?>
			</label>
			<input
				type="text"
				id="event_location"
				name="event_location"
				value="<?php echo esc_attr( $event_location ); ?>"
				style="width: 100%;"
				placeholder="<?php esc_attr_e( 'Event location', 'fair-events' ); ?>"
			/>
		</p>
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

		// Check if this is a fair_event post
		$post = get_post( $post_id );
		if ( ! $post || self::POST_TYPE !== $post->post_type ) {
			return;
		}

		// $meta_value contains the original post ID
		$origin_id = $meta_value;

		// Check if origin post exists
		$origin_post = get_post( $origin_id );
		if ( ! $origin_post ) {
			return;
		}

		// Copy event metadata from original post
		$event_dates    = \FairEvents\Models\EventDates::get_by_event_id( $origin_id );
		$event_location = get_post_meta( $origin_id, 'event_location', true );

		if ( $event_dates ) {
			\FairEvents\Models\EventDates::save(
				$post_id,
				$event_dates->start_datetime,
				$event_dates->end_datetime,
				$event_dates->all_day
			);
		}
		if ( $event_location ) {
			update_post_meta( $post_id, 'event_location', $event_location );
		}
	}

	/**
	 * Register admin columns
	 *
	 * @return void
	 */
	public static function register_admin_columns() {
		add_filter( 'manage_' . self::POST_TYPE . '_posts_columns', array( __CLASS__, 'add_admin_columns' ) );
		add_action( 'manage_' . self::POST_TYPE . '_posts_custom_column', array( __CLASS__, 'render_admin_column' ), 10, 2 );
		add_filter( 'manage_edit-' . self::POST_TYPE . '_sortable_columns', array( __CLASS__, 'add_sortable_columns' ) );
		add_action( 'pre_get_posts', array( __CLASS__, 'handle_column_sorting' ) );
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
				$new_columns['event_start']    = __( 'Event Start', 'fair-events' );
				$new_columns['event_end']      = __( 'Event End', 'fair-events' );
				$new_columns['event_all_day']  = __( 'All Day', 'fair-events' );
				$new_columns['event_location'] = __( 'Location', 'fair-events' );
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
		switch ( $column ) {
			case 'event_start':
			case 'event_end':
				$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
				if ( $event_dates ) {
					$value = ( 'event_start' === $column ) ? $event_dates->start_datetime : $event_dates->end_datetime;
					if ( $value ) {
						echo esc_html( self::format_event_datetime( $value, $event_dates->all_day ) );
					} else {
						echo '—';
					}
				} else {
					echo '—';
				}
				break;

			case 'event_all_day':
				$event_dates = \FairEvents\Models\EventDates::get_by_event_id( $post_id );
				echo ( $event_dates && $event_dates->all_day ) ? esc_html__( 'Yes', 'fair-events' ) : '';
				break;

			case 'event_location':
				$location = get_post_meta( $post_id, 'event_location', true );
				echo $location ? esc_html( $location ) : '—';
				break;
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
		$columns['event_start'] = 'event_start';
		$columns['event_end']   = 'event_end';
		return $columns;
	}

	/**
	 * Handle sorting by event meta fields
	 *
	 * @param \WP_Query $query The query object.
	 * @return void
	 */
	public static function handle_column_sorting( $query ) {
		if ( ! is_admin() || ! $query->is_main_query() ) {
			return;
		}

		$orderby = $query->get( 'orderby' );

		if ( 'event_start' === $orderby ) {
			$query->set( 'meta_key', 'event_start' );
			$query->set( 'orderby', 'meta_value' );
		} elseif ( 'event_end' === $orderby ) {
			$query->set( 'meta_key', 'event_end' );
			$query->set( 'orderby', 'meta_value' );
		}
	}

	/**
	 * Save meta box data
	 *
	 * @param int $post_id The post ID.
	 * @return void
	 */
	public static function save_meta_box( $post_id ) {
		// Check if nonce is set.
		if ( ! isset( $_POST['fair_event_meta_box_nonce'] ) ) {
			return;
		}

		// Verify nonce.
		if ( ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['fair_event_meta_box_nonce'] ) ), 'fair_event_meta_box' ) ) {
			return;
		}

		// Check if this is an autosave.
		if ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) {
			return;
		}

		// Check user permissions.
		if ( ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		// Check if this is our post type.
		if ( self::POST_TYPE !== get_post_type( $post_id ) ) {
			return;
		}

		// Get event data
		$event_start   = isset( $_POST['event_start'] ) ? sanitize_text_field( wp_unslash( $_POST['event_start'] ) ) : '';
		$event_end     = isset( $_POST['event_end'] ) ? sanitize_text_field( wp_unslash( $_POST['event_end'] ) ) : '';
		$event_all_day = isset( $_POST['event_all_day'] ) ? true : false;

		// Save to custom table (also updates postmeta automatically for compatibility)
		\FairEvents\Models\EventDates::save( $post_id, $event_start, $event_end, $event_all_day );

		// Save event_location separately (not in dates table)
		if ( isset( $_POST['event_location'] ) ) {
			update_post_meta( $post_id, 'event_location', sanitize_text_field( wp_unslash( $_POST['event_location'] ) ) );
		}
	}
}
