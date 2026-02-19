<?php
/**
 * Event Gallery Page Handler
 *
 * @package FairEvents
 */

namespace FairEvents\Frontend;

use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Handles the frontend event gallery page.
 */
class EventGalleryPage {

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'add_rewrite_rules' ) );
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'handle_template' ) );
		add_filter( 'the_content', array( __CLASS__, 'add_gallery_link_to_content' ) );
	}

	/**
	 * Add rewrite rules for the gallery page.
	 */
	public static function add_rewrite_rules() {
		add_rewrite_rule(
			'^event-gallery/([0-9]+)/?$',
			'index.php?event_gallery_id=$matches[1]',
			'top'
		);
	}

	/**
	 * Add query variables.
	 *
	 * @param array $vars Query variables.
	 * @return array Modified query variables.
	 */
	public static function add_query_vars( $vars ) {
		$vars[] = 'event_gallery_id';
		$vars[] = 'gallery_key';
		return $vars;
	}

	/**
	 * Handle the gallery page template.
	 */
	public static function handle_template() {
		$event_id    = get_query_var( 'event_gallery_id' );
		$gallery_key = get_query_var( 'gallery_key' );

		// Handle gallery_key access (token-based).
		if ( ! empty( $gallery_key ) ) {
			self::handle_gallery_key_access( $gallery_key );
			return;
		}

		if ( empty( $event_id ) ) {
			return;
		}

		// Resolve to primary event_id for secondary linked posts.
		$event_id = self::resolve_primary_event_id( $event_id );

		// Validate event exists and is an enabled post type.
		$event              = get_post( $event_id );
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! $event || ! in_array( $event->post_type, $enabled_post_types, true ) ) {
			global $wp_query;
			$wp_query->set_404();
			status_header( 404 );
			nocache_headers();
			include get_query_template( '404' );
			exit;
		}

		// Check if user is logged in.
		if ( ! is_user_logged_in() ) {
			$redirect_url = self::get_gallery_url( $event_id );
			wp_safe_redirect( wp_login_url( $redirect_url ) );
			exit;
		}

		// Render the gallery page (user-based access).
		self::render_page( $event );
		exit;
	}

	/**
	 * Handle gallery access via token (gallery_key).
	 *
	 * @param string $gallery_key The gallery access token.
	 */
	private static function handle_gallery_key_access( $gallery_key ) {
		// Validate the token via fair-audience repository.
		$access_data = self::validate_gallery_token( $gallery_key );

		if ( ! $access_data ) {
			// Invalid token - show error page.
			global $wp_query;
			$wp_query->set_404();
			status_header( 404 );
			nocache_headers();
			include get_query_template( '404' );
			exit;
		}

		// Get the event.
		$event              = get_post( $access_data['event_id'] );
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! $event || ! in_array( $event->post_type, $enabled_post_types, true ) ) {
			global $wp_query;
			$wp_query->set_404();
			status_header( 404 );
			nocache_headers();
			include get_query_template( '404' );
			exit;
		}

		// Render the gallery page with participant context.
		self::render_page( $event, $access_data['participant_id'] );
		exit;
	}

	/**
	 * Validate gallery token using fair-audience repository.
	 *
	 * @param string $token The gallery access token.
	 * @return array|null Array with event_id and participant_id if valid, null otherwise.
	 */
	private static function validate_gallery_token( $token ) {
		// Check if fair-audience plugin is active.
		if ( ! class_exists( '\FairAudience\Database\GalleryAccessKeyRepository' ) ) {
			return null;
		}

		$repository = new \FairAudience\Database\GalleryAccessKeyRepository();
		$access_key = $repository->get_by_token( $token );

		if ( ! $access_key ) {
			return null;
		}

		return array(
			'event_id'       => $access_key->event_id,
			'participant_id' => $access_key->participant_id,
		);
	}

	/**
	 * Render the gallery page.
	 *
	 * @param WP_Post  $event          Event post object.
	 * @param int|null $participant_id Optional participant ID for token-based access.
	 */
	private static function render_page( $event, $participant_id = null ) {
		// Enqueue scripts and styles.
		self::enqueue_assets( $event, $participant_id );

		// Render the page.
		?>
		<!DOCTYPE html>
		<html <?php language_attributes(); ?>>
		<head>
			<meta charset="<?php bloginfo( 'charset' ); ?>">
			<meta name="viewport" content="width=device-width, initial-scale=1">
			<title><?php echo esc_html( $event->post_title ); ?> - <?php bloginfo( 'name' ); ?></title>
			<?php wp_head(); ?>
		</head>
		<body class="fair-events-gallery-page">
			<div id="fair-events-gallery-root"
				data-event-id="<?php echo esc_attr( $event->ID ); ?>"
				data-event-title="<?php echo esc_attr( $event->post_title ); ?>"
				data-event-url="<?php echo esc_url( get_permalink( $event->ID ) ); ?>"
				<?php if ( $participant_id ) : ?>
				data-participant-id="<?php echo esc_attr( $participant_id ); ?>"
				<?php endif; ?>
			>
			</div>
			<?php wp_footer(); ?>
		</body>
		</html>
		<?php
	}

	/**
	 * Enqueue scripts and styles for the gallery page.
	 *
	 * @param WP_Post  $event          Event post object.
	 * @param int|null $participant_id Optional participant ID for token-based access.
	 */
	private static function enqueue_assets( $event, $participant_id = null ) {
		$asset_file = FAIR_EVENTS_PLUGIN_DIR . 'build/frontend/event-gallery.asset.php';

		if ( ! file_exists( $asset_file ) ) {
			return;
		}

		$asset = include $asset_file;

		wp_enqueue_script(
			'fair-events-gallery',
			FAIR_EVENTS_PLUGIN_URL . 'build/frontend/event-gallery.js',
			$asset['dependencies'],
			$asset['version'],
			true
		);

		wp_enqueue_style(
			'fair-events-gallery',
			FAIR_EVENTS_PLUGIN_URL . 'build/frontend/style-event-gallery.css',
			array(),
			$asset['version']
		);

		// Build script data.
		$script_data = array(
			'eventId'    => $event->ID,
			'eventTitle' => $event->post_title,
			'eventUrl'   => get_permalink( $event->ID ),
			'apiUrl'     => rest_url( 'fair-events/v1' ),
			'nonce'      => wp_create_nonce( 'wp_rest' ),
			'i18n'       => array(
				'loading'  => __( 'Loading...', 'fair-events' ),
				'error'    => __( 'Failed to load photos.', 'fair-events' ),
				'noPhotos' => __( 'No photos available for this event.', 'fair-events' ),
				'like'     => __( 'Like', 'fair-events' ),
				'unlike'   => __( 'Unlike', 'fair-events' ),
			),
		);

		// Add participant ID if token-based access.
		if ( $participant_id ) {
			$script_data['participantId'] = $participant_id;
		}

		// Pass data to JavaScript.
		wp_localize_script(
			'fair-events-gallery',
			'fairEventsGallery',
			$script_data
		);

		wp_set_script_translations(
			'fair-events-gallery',
			'fair-events',
			FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
		);
	}

	/**
	 * Add gallery link to event content for logged-in users.
	 *
	 * @param string $content Post content.
	 * @return string Modified content.
	 */
	public static function add_gallery_link_to_content( $content ) {
		// Only on single event pages (any enabled post type).
		$enabled_post_types = Settings::get_enabled_post_types();
		if ( ! is_singular( $enabled_post_types ) ) {
			return $content;
		}

		// Only for logged-in users.
		if ( ! is_user_logged_in() ) {
			return $content;
		}

		// Check if event has photos.
		$event_id = get_the_ID();
		if ( ! $event_id ) {
			return $content;
		}

		// Resolve to primary event_id for secondary linked posts.
		$resolved_event_id = self::resolve_primary_event_id( $event_id );

		$repository  = new \FairEvents\Database\EventPhotoRepository();
		$photo_count = $repository->get_count_by_event( $resolved_event_id );

		if ( $photo_count < 1 ) {
			return $content;
		}

		// Build gallery link using primary event_id.
		$gallery_url = self::get_gallery_url( $resolved_event_id );
		$link_text   = sprintf(
			/* translators: %d: number of photos */
			_n(
				"Review Event's Photos (%d photo)",
				"Review Event's Photos (%d photos)",
				$photo_count,
				'fair-events'
			),
			$photo_count
		);

		$gallery_link = sprintf(
			'<p class="fair-events-gallery-link"><a href="%s">%s</a></p>',
			esc_url( $gallery_url ),
			esc_html( $link_text )
		);

		return $content . $gallery_link;
	}

	/**
	 * Resolve a post ID to the primary event_id.
	 *
	 * If the given post_id is a secondary linked post, returns the primary
	 * event_id from the event_dates table. Otherwise returns the input unchanged.
	 *
	 * @param int $post_id Post ID to resolve.
	 * @return int The primary event_id, or the input if not a secondary post.
	 */
	private static function resolve_primary_event_id( $post_id ) {
		$event_date = \FairEvents\Models\EventDates::get_by_event_id( $post_id );

		if ( ! $event_date ) {
			return $post_id;
		}

		// If event_id is set and different from the given post_id, the given post
		// is a secondary linked post - return the primary event_id.
		if ( $event_date->event_id && (int) $event_date->event_id !== (int) $post_id ) {
			return (int) $event_date->event_id;
		}

		return $post_id;
	}

	/**
	 * Get the gallery URL for an event.
	 *
	 * Uses query string format to work with any permalink structure.
	 *
	 * @param int $event_id Event ID.
	 * @return string Gallery URL.
	 */
	public static function get_gallery_url( $event_id ) {
		return add_query_arg( 'event_gallery_id', $event_id, home_url( '/' ) );
	}

	/**
	 * Flush rewrite rules on plugin activation.
	 */
	public static function activate() {
		self::add_rewrite_rules();
		flush_rewrite_rules();
	}

	/**
	 * Flush rewrite rules on plugin deactivation.
	 */
	public static function deactivate() {
		flush_rewrite_rules();
	}
}
