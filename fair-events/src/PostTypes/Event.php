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
	 * @return void
	 */
	public static function register_meta() {
		$enabled_post_types = Settings::get_enabled_post_types();

		foreach ( $enabled_post_types as $post_type ) {
			register_post_meta(
				$post_type,
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
				$post_type,
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
				$post_type,
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
	 * @param \WP_Post $post The post object.
	 * @return void
	 */
	public static function render_meta_box( $post ) {
		wp_nonce_field( 'fair_event_meta_box', 'fair_event_meta_box_nonce' );

		$event_start      = get_post_meta( $post->ID, 'event_start', true );
		$event_end        = get_post_meta( $post->ID, 'event_end', true );
		$event_all_day    = get_post_meta( $post->ID, 'event_all_day', true );
		$event_location   = get_post_meta( $post->ID, 'event_location', true );
		$event_recurrence = \FairEvents\Models\EventDates::get_rrule_by_event_id( $post->ID );

		// Get venue data.
		$event_dates      = \FairEvents\Models\EventDates::get_by_event_id( $post->ID );
		$current_venue_id = $event_dates ? $event_dates->venue_id : null;
		$venues           = \FairEvents\Models\Venue::get_all();

		// Check for event_date URL parameter (from calendar "add event" button) for new posts.
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- Read-only operation for prepopulating form.
		if ( empty( $event_start ) && isset( $_GET['event_date'] ) ) {
			$url_date = sanitize_text_field( wp_unslash( $_GET['event_date'] ) );
			// Validate date format (Y-m-d).
			if ( preg_match( '/^\d{4}-\d{2}-\d{2}$/', $url_date ) ) {
				// Default to datetime with 10:00 start time.
				$event_start = $url_date . 'T10:00';
			}
		}

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

		// Parse recurrence settings.
		$recurrence_enabled  = ! empty( $event_recurrence );
		$parsed_rrule        = $recurrence_enabled ? \FairEvents\Services\RecurrenceService::parse_rrule( $event_recurrence ) : array();
		$recurrence_freq     = $parsed_rrule['freq'] ?? '';
		$recurrence_interval = $parsed_rrule['interval'] ?? 1;
		$recurrence_count    = $parsed_rrule['count'] ?? '';
		$recurrence_until    = ! empty( $parsed_rrule['until'] ) ? $parsed_rrule['until']->format( 'Y-m-d' ) : '';
		$recurrence_end_type = $recurrence_count ? 'count' : ( $recurrence_until ? 'until' : 'count' );

		// Map frequency + interval to simplified frequency.
		$simple_frequency = '';
		if ( 'DAILY' === $recurrence_freq ) {
			$simple_frequency = 'daily';
		} elseif ( 'WEEKLY' === $recurrence_freq && 1 === $recurrence_interval ) {
			$simple_frequency = 'weekly';
		} elseif ( 'WEEKLY' === $recurrence_freq && 2 === $recurrence_interval ) {
			$simple_frequency = 'biweekly';
		} elseif ( 'MONTHLY' === $recurrence_freq ) {
			$simple_frequency = 'monthly';
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
			<label for="event_duration">
				<?php esc_html_e( 'Event Length', 'fair-events' ); ?>
			</label>
			<select id="event_duration" name="event_duration" style="width: 100%; box-sizing: border-box;">
				<option value="other"><?php esc_html_e( 'Other', 'fair-events' ); ?></option>
			</select>
			<small class="description">
				<?php esc_html_e( 'Select a duration to automatically set the end time', 'fair-events' ); ?>
			</small>
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
			<label for="event_venue_id">
				<?php esc_html_e( 'Venue', 'fair-events' ); ?>
			</label>
			<select id="event_venue_id" name="event_venue_id" style="width: 100%; box-sizing: border-box;">
				<option value=""><?php esc_html_e( 'No venue', 'fair-events' ); ?></option>
				<?php foreach ( $venues as $venue ) : ?>
					<option value="<?php echo esc_attr( $venue->id ); ?>" <?php selected( $current_venue_id, $venue->id ); ?>>
						<?php echo esc_html( $venue->name ); ?>
					</option>
				<?php endforeach; ?>
				<option value="new"><?php esc_html_e( '+ Add new venue...', 'fair-events' ); ?></option>
			</select>
		</p>
		<div id="new_venue_form" style="display: none; padding: 10px; background: #f9f9f9; border: 1px solid #ddd; margin-bottom: 10px;">
			<p>
				<label for="new_venue_name"><?php esc_html_e( 'Venue Name', 'fair-events' ); ?></label>
				<input type="text" id="new_venue_name" style="width: 100%;" />
			</p>
			<p>
				<label for="new_venue_address"><?php esc_html_e( 'Address', 'fair-events' ); ?></label>
				<textarea id="new_venue_address" style="width: 100%;" rows="2"></textarea>
			</p>
			<p>
				<button type="button" id="save_new_venue" class="button button-primary">
					<?php esc_html_e( 'Save Venue', 'fair-events' ); ?>
				</button>
				<button type="button" id="cancel_new_venue" class="button">
					<?php esc_html_e( 'Cancel', 'fair-events' ); ?>
				</button>
				<span id="new_venue_error" style="color: red; margin-left: 10px;"></span>
			</p>
		</div>
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

		<hr style="margin: 15px 0;" />

		<details id="recurrence_details" <?php echo $recurrence_enabled ? 'open' : ''; ?>>
			<summary style="cursor: pointer; font-weight: 600; margin-bottom: 10px;">
				<?php esc_html_e( 'Recurrence', 'fair-events' ); ?>
			</summary>

			<p>
				<label for="event_recurrence_enabled">
					<input
						type="checkbox"
						id="event_recurrence_enabled"
						name="event_recurrence_enabled"
						value="1"
						<?php checked( $recurrence_enabled, true ); ?>
					/>
					<?php esc_html_e( 'Repeat this event', 'fair-events' ); ?>
				</label>
			</p>

			<div id="recurrence_options" style="<?php echo $recurrence_enabled ? '' : 'display: none;'; ?>">
				<p>
					<label for="event_recurrence_frequency">
						<?php esc_html_e( 'Frequency', 'fair-events' ); ?>
					</label>
					<select id="event_recurrence_frequency" name="event_recurrence_frequency" style="width: 100%; box-sizing: border-box;">
						<option value="daily" <?php selected( $simple_frequency, 'daily' ); ?>><?php esc_html_e( 'Daily', 'fair-events' ); ?></option>
						<option value="weekly" <?php selected( $simple_frequency, 'weekly' ); ?>><?php esc_html_e( 'Weekly', 'fair-events' ); ?></option>
						<option value="biweekly" <?php selected( $simple_frequency, 'biweekly' ); ?>><?php esc_html_e( 'Biweekly', 'fair-events' ); ?></option>
						<option value="monthly" <?php selected( $simple_frequency, 'monthly' ); ?>><?php esc_html_e( 'Monthly', 'fair-events' ); ?></option>
					</select>
				</p>

				<p>
					<label for="event_recurrence_end_type">
						<?php esc_html_e( 'End', 'fair-events' ); ?>
					</label>
					<select id="event_recurrence_end_type" name="event_recurrence_end_type" style="width: 100%; box-sizing: border-box;">
						<option value="count" <?php selected( $recurrence_end_type, 'count' ); ?>><?php esc_html_e( 'After number of occurrences', 'fair-events' ); ?></option>
						<option value="until" <?php selected( $recurrence_end_type, 'until' ); ?>><?php esc_html_e( 'On date', 'fair-events' ); ?></option>
					</select>
				</p>

				<p id="recurrence_count_wrapper" style="<?php echo $recurrence_end_type === 'until' ? 'display: none;' : ''; ?>">
					<label for="event_recurrence_count">
						<?php esc_html_e( 'Number of occurrences', 'fair-events' ); ?>
					</label>
					<input
						type="number"
						id="event_recurrence_count"
						name="event_recurrence_count"
						value="<?php echo esc_attr( $recurrence_count ? $recurrence_count : 10 ); ?>"
						min="2"
						max="100"
						style="width: 100%;"
					/>
				</p>

				<p id="recurrence_until_wrapper" style="<?php echo $recurrence_end_type === 'count' ? 'display: none;' : ''; ?>">
					<label for="event_recurrence_until">
						<?php esc_html_e( 'End date', 'fair-events' ); ?>
					</label>
					<input
						type="date"
						id="event_recurrence_until"
						name="event_recurrence_until"
						value="<?php echo esc_attr( $recurrence_until ); ?>"
						style="width: 100%;"
					/>
				</p>

				<input type="hidden" id="event_recurrence" name="event_recurrence" value="<?php echo esc_attr( $event_recurrence ); ?>" />
			</div>
		</details>
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

		if ( 'event_datetime' === $orderby ) {
			$query->set( 'meta_key', 'event_start' );
			$query->set( 'orderby', 'meta_value' );
		}
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

		// Check if this post type is enabled for events.
		$post_type          = get_post_type( $post_id );
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! in_array( $post_type, $enabled_post_types, true ) ) {
			return;
		}

		// Get event data
		$event_start   = isset( $_POST['event_start'] ) ? sanitize_text_field( wp_unslash( $_POST['event_start'] ) ) : '';
		$event_end     = isset( $_POST['event_end'] ) ? sanitize_text_field( wp_unslash( $_POST['event_end'] ) ) : '';
		$event_all_day = isset( $_POST['event_all_day'] ) ? true : false;

		// Auto-set end time if not provided
		if ( empty( $event_end ) && ! empty( $event_start ) ) {
			$start_timestamp = strtotime( $event_start );
			if ( false !== $start_timestamp ) {
				if ( $event_all_day ) {
					// All-day event: add 1 day
					$event_end = gmdate( 'Y-m-d', $start_timestamp + DAY_IN_SECONDS );
				} else {
					// Timed event: add 1 hour
					$event_end = gmdate( 'Y-m-d\TH:i', $start_timestamp + HOUR_IN_SECONDS );
				}
			}
		}

		// Save to custom table (also updates postmeta automatically for compatibility)
		\FairEvents\Models\EventDates::save( $post_id, $event_start, $event_end, $event_all_day );

		// Save event_location separately (not in dates table)
		if ( isset( $_POST['event_location'] ) ) {
			update_post_meta( $post_id, 'event_location', sanitize_text_field( wp_unslash( $_POST['event_location'] ) ) );
		}

		// Save venue_id.
		if ( isset( $_POST['event_venue_id'] ) ) {
			$venue_id = sanitize_text_field( wp_unslash( $_POST['event_venue_id'] ) );
			// "new" value is handled via JavaScript API call, so skip it here.
			if ( '' === $venue_id || 'new' === $venue_id ) {
				$venue_id = null;
			} else {
				$venue_id = absint( $venue_id );
			}
			\FairEvents\Models\EventDates::save_venue_id( $post_id, $venue_id );
		}

		// Handle recurrence.
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- checkbox only checked for presence.
		$recurrence_enabled = isset( $_POST['event_recurrence_enabled'] ) && ! empty( wp_unslash( $_POST['event_recurrence_enabled'] ) );

		// Use empty string to explicitly indicate "no recurrence" vs null which means "read from DB".
		$rrule = '';
		if ( $recurrence_enabled ) {
			// Build RRULE from form fields.
			$frequency = isset( $_POST['event_recurrence_frequency'] ) ? sanitize_text_field( wp_unslash( $_POST['event_recurrence_frequency'] ) ) : 'weekly';
			$end_type  = isset( $_POST['event_recurrence_end_type'] ) ? sanitize_text_field( wp_unslash( $_POST['event_recurrence_end_type'] ) ) : 'count';
			$count     = isset( $_POST['event_recurrence_count'] ) ? absint( $_POST['event_recurrence_count'] ) : 10;
			$until     = isset( $_POST['event_recurrence_until'] ) ? sanitize_text_field( wp_unslash( $_POST['event_recurrence_until'] ) ) : '';

			// Map simplified frequency to RRULE frequency and interval.
			$rrule_freq     = 'WEEKLY';
			$rrule_interval = 1;

			switch ( $frequency ) {
				case 'daily':
					$rrule_freq     = 'DAILY';
					$rrule_interval = 1;
					break;
				case 'weekly':
					$rrule_freq     = 'WEEKLY';
					$rrule_interval = 1;
					break;
				case 'biweekly':
					$rrule_freq     = 'WEEKLY';
					$rrule_interval = 2;
					break;
				case 'monthly':
					$rrule_freq     = 'MONTHLY';
					$rrule_interval = 1;
					break;
			}

			$rrule = \FairEvents\Services\RecurrenceService::build_rrule(
				$rrule_freq,
				$rrule_interval,
				$end_type,
				'count' === $end_type ? $count : null,
				'until' === $end_type ? $until : null
			);
		}

		// Regenerate occurrences (this handles both recurring and non-recurring events).
		// Pass the RRULE directly so it gets saved to the database table.
		\FairEvents\Services\RecurrenceService::regenerate_event_occurrences( $post_id, $rrule );
	}
}
