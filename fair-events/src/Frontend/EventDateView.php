<?php
/**
 * Public view of a single standalone event date
 *
 * @package FairEvents
 */

namespace FairEvents\Frontend;

defined( 'WPINC' ) || die;

use FairEvents\Helpers\DateRangeFormatter;
use FairEvents\Helpers\EventLocation;
use FairEvents\Models\EventDates;

/**
 * Serves `?fair_event_date={id}`: a minimal public page identifying one
 * event date, used as the link target for standalone events that have no
 * page of their own (e.g. the iCal feed's URL/DESCRIPTION fallback, #1691).
 *
 * Only active, published standalone rows are shown. A standalone row that has
 * since gained a link redirects there, so feed links issued earlier keep
 * working; post-linked, cancelled, drafted, and missing rows get a 404.
 */
class EventDateView {

	/**
	 * Query variable carrying the event date ID.
	 *
	 * @var string
	 */
	const QUERY_VAR = 'fair_event_date';

	/**
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		add_action( 'template_redirect', array( __CLASS__, 'handle_request' ) );
	}

	/**
	 * Public URL of the view for an event date.
	 *
	 * @param int $event_date_id Event date ID.
	 * @return string
	 */
	public static function url( $event_date_id ) {
		return add_query_arg( self::QUERY_VAR, absint( $event_date_id ), home_url( '/' ) );
	}

	/**
	 * Register the query variable so WordPress parses it.
	 *
	 * @param array $vars Query variables.
	 * @return array Modified query variables.
	 */
	public static function add_query_vars( $vars ) {
		$vars[] = self::QUERY_VAR;
		return $vars;
	}

	/**
	 * Render the view, redirect, or 404 for requests carrying the query var.
	 *
	 * @return void
	 */
	public static function handle_request() {
		$raw = (string) get_query_var( self::QUERY_VAR );

		if ( '' === $raw ) {
			return;
		}

		$event_date = ctype_digit( $raw ) ? EventDates::get_by_id( absint( $raw ) ) : null;

		if ( ! $event_date || 'active' !== $event_date->status || $event_date->is_event_draft() || $event_date->get_resolved_event_id() ) {
			self::not_found();
			return;
		}

		$display_url = $event_date->get_display_url();
		if ( $display_url ) {
			// Admin-configured link, possibly on another site.
			wp_redirect( $display_url ); // phpcs:ignore WordPress.Security.SafeRedirect.wp_redirect_wp_redirect
			exit;
		}

		self::render( $event_date );
		exit;
	}

	/**
	 * Mark the main query as a 404 and let the theme render its 404 page.
	 *
	 * @return void
	 */
	private static function not_found() {
		global $wp_query;

		$wp_query->set_404();
		status_header( 404 );
		nocache_headers();
	}

	/**
	 * Output the event page.
	 *
	 * @param EventDates $event_date Active standalone event date.
	 * @return void
	 */
	private static function render( EventDates $event_date ) {
		$title = $event_date->get_display_title();
		if ( empty( $title ) ) {
			$title = __( '(untitled event)', 'fair-events' );
		}

		$date_text = DateRangeFormatter::format(
			$event_date->start_datetime,
			(string) $event_date->end_datetime,
			$event_date->all_day
		);

		$location      = EventLocation::resolve( $event_date, null );
		$location_text = implode(
			', ',
			array_filter(
				array(
					$location['name'] ?? '',
					$location['address'] ?? '',
				)
			)
		);
		$joining_url   = $location['joining_url'] ?? '';

		add_filter(
			'document_title_parts',
			function ( $parts ) use ( $title ) {
				$parts['title'] = $title;
				return $parts;
			}
		);

		status_header( 200 );
		header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
		?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
		<?php wp_head(); ?>
</head>
<body <?php body_class( 'fair-event-date-view' ); ?>>
		<?php wp_body_open(); ?>
	<main class="wp-block-group is-layout-constrained" style="padding: 2rem 1rem;">
		<h1><?php echo esc_html( $title ); ?></h1>
		<p class="fair-event-date-view__date"><?php echo esc_html( $date_text ); ?></p>
		<?php if ( '' !== $location_text ) : ?>
			<p class="fair-event-date-view__location"><?php echo esc_html( $location_text ); ?></p>
		<?php endif; ?>
		<?php if ( '' !== $joining_url ) : ?>
			<p class="fair-event-date-view__joining-link"><a href="<?php echo esc_url( $joining_url ); ?>"><?php esc_html_e( 'Join online', 'fair-events' ); ?></a></p>
		<?php endif; ?>
		<p><a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php echo esc_html( get_bloginfo( 'name' ) ); ?></a></p>
	</main>
		<?php wp_footer(); ?>
</body>
</html>
		<?php
	}
}
