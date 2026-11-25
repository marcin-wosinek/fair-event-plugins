<?php
/**
 * Public marketing asset pages.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Frontend;

defined( 'WPINC' ) || die;

use FairEvents\Models\EventDates;
use FairEventsExperimental\Core\Features;
use FairEventsExperimental\Core\Plugin;
use FairEventsExperimental\Services\PublicMarketingAssets;
use FairEventsShared\Helpers\DisplayText;

/**
 * Serves the public marketing asset pages (#2430), with no account or
 * secret link needed:
 *
 * - `?fair_marketing_assets=all` — every occurrence with an asset page;
 * - `?fair_marketing_assets={event_date_id}` — one occurrence's assets, to
 *   browse, filter, copy and download.
 *
 * Query-variable links work with any permalink setting. While the
 * `marketing-assets` bundle is off, both answer the theme's 404. Pages are
 * marked `noindex` and never cached. The page renders a shell; its script
 * loads the assets from {@see \FairEventsExperimental\API\PublicMarketingAssetsController}.
 */
class MarketingAssetsPage {

	/**
	 * Query variable: `all`, or an event date ID.
	 *
	 * @var string
	 */
	const QUERY_VAR = 'fair_marketing_assets';

	/**
	 * Query variable value of the index.
	 *
	 * @var string
	 */
	const INDEX = 'all';

	/**
	 * Script and style handle.
	 *
	 * @var string
	 */
	const HANDLE = 'fair-events-experimental-marketing-assets';

	/**
	 * Initialize hooks. Registered with every bundle state, so a link
	 * opened while the bundle is off is a 404 rather than the home page.
	 *
	 * @return void
	 */
	public static function init() {
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		// Before redirect_canonical(), which knows nothing of this view.
		add_action( 'template_redirect', array( __CLASS__, 'handle_request' ), 1 );
	}

	/**
	 * Link to the index of every occurrence's asset page.
	 *
	 * @return string
	 */
	public static function index_url() {
		return add_query_arg( self::QUERY_VAR, self::INDEX, home_url( '/' ) );
	}

	/**
	 * Link to one occurrence's asset page.
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
	 * Render the index, an occurrence's page, or a 404.
	 *
	 * @return void
	 */
	public static function handle_request() {
		$raw = (string) get_query_var( self::QUERY_VAR );
		if ( '' === $raw ) {
			return;
		}

		self::prevent_caching();

		if ( ! Plugin::marketing_assets_available() ) {
			self::theme_not_found();
			return;
		}

		if ( self::INDEX === $raw ) {
			self::render_index();
			exit;
		}

		$event_date = ctype_digit( $raw ) ? EventDates::get_by_id( absint( $raw ) ) : null;
		if ( ! $event_date ) {
			self::render_missing();
			exit;
		}

		self::render_occurrence( $event_date );
		exit;
	}

	/**
	 * Keep the page out of search engines, page caches and CDNs.
	 *
	 * @return void
	 */
	private static function prevent_caching() {
		add_filter( 'wp_robots', 'wp_robots_no_robots' );
		if ( ! defined( 'DONOTCACHEPAGE' ) ) {
			define( 'DONOTCACHEPAGE', true );
		}
		nocache_headers();
		header( 'Cache-Control: no-store, no-cache, must-revalidate, max-age=0' );
		header( 'X-Robots-Tag: noindex' );
	}

	/**
	 * Let the theme render its 404 page.
	 *
	 * @return void
	 */
	private static function theme_not_found() {
		global $wp_query;

		$wp_query->set_404();
		status_header( 404 );
	}

	/**
	 * Output the index of every occurrence's asset page.
	 *
	 * @return void
	 */
	private static function render_index() {
		self::enqueue_assets();
		self::open_document( __( 'Marketing assets', 'fair-events-experimental' ) );
		?>
	<main class="fair-marketing-assets">
		<header class="fair-marketing-assets__header">
			<p class="fair-marketing-assets__eyebrow"><?php echo esc_html( get_bloginfo( 'name' ) ); ?></p>
			<h1 class="fair-marketing-assets__title"><?php esc_html_e( 'Marketing assets', 'fair-events-experimental' ); ?></h1>
			<p class="fair-marketing-assets__intro"><?php esc_html_e( 'Text and images for promoting each event. Open an event to copy its texts and download its images.', 'fair-events-experimental' ); ?></p>
		</header>
		<div class="fair-marketing-assets__app" data-view="index">
			<noscript><p class="fair-marketing-assets__notice"><?php esc_html_e( 'Turn on JavaScript to see the events.', 'fair-events-experimental' ); ?></p></noscript>
		</div>
	</main>
		<?php
		self::close_document();
	}

	/**
	 * Output one occurrence's asset page.
	 *
	 * @param EventDates $event_date Event date.
	 * @return void
	 */
	private static function render_occurrence( EventDates $event_date ) {
		$title   = PublicMarketingAssets::public_title( $event_date );
		$heading = null === $title
			? sprintf(
				/* translators: %d: event date ID */
				__( 'Event #%d', 'fair-events-experimental' ),
				(int) $event_date->id
			)
			: $title;

		self::enqueue_assets();
		self::open_document(
			sprintf(
				/* translators: %s: event title, or "Event #12" for an unpublished event */
				__( 'Marketing assets: %s', 'fair-events-experimental' ),
				$heading
			)
		);
		?>
	<main class="fair-marketing-assets">
		<header class="fair-marketing-assets__header">
			<p class="fair-marketing-assets__back"><a href="<?php echo esc_url( self::index_url() ); ?>"><?php esc_html_e( 'All events', 'fair-events-experimental' ); ?></a></p>
			<p class="fair-marketing-assets__eyebrow"><?php esc_html_e( 'Marketing assets', 'fair-events-experimental' ); ?></p>
			<?php // Decoded once by PublicMarketingAssets::public_title(); DisplayText::html() escapes it without a second decode. ?>
			<h1 class="fair-marketing-assets__title"><?php echo DisplayText::html( $heading ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- DisplayText::html() escapes decoded text. ?></h1>
			<p class="fair-marketing-assets__intro"><?php esc_html_e( 'Copy a text or download an image, then post it wherever you promote the event.', 'fair-events-experimental' ); ?></p>
		</header>
		<div class="fair-marketing-assets__app" data-view="occurrence" data-event-date-id="<?php echo esc_attr( (string) (int) $event_date->id ); ?>">
			<noscript><p class="fair-marketing-assets__notice"><?php esc_html_e( 'Turn on JavaScript to see the marketing assets.', 'fair-events-experimental' ); ?></p></noscript>
		</div>
	</main>
		<?php
		self::close_document();
	}

	/**
	 * Output the page of an occurrence that doesn't exist.
	 *
	 * @return void
	 */
	private static function render_missing() {
		self::enqueue_assets( false );
		self::open_document( __( 'Marketing assets not found', 'fair-events-experimental' ), 404 );
		?>
	<main class="fair-marketing-assets">
		<h1 class="fair-marketing-assets__title"><?php esc_html_e( 'Marketing assets not found', 'fair-events-experimental' ); ?></h1>
		<p class="fair-marketing-assets__notice fair-marketing-assets__notice--error" role="alert"><?php esc_html_e( 'This event does not exist. Check the link you were given, or open the list of all events.', 'fair-events-experimental' ); ?></p>
		<p><a href="<?php echo esc_url( self::index_url() ); ?>"><?php esc_html_e( 'All events', 'fair-events-experimental' ); ?></a></p>
	</main>
		<?php
		self::close_document();
	}

	/**
	 * Enqueue the page's styles and, unless told otherwise, its script.
	 *
	 * @param bool $with_script Whether to load the script.
	 * @return void
	 */
	private static function enqueue_assets( $with_script = true ) {
		$asset_file = FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/frontend/marketing-assets.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = include $asset_file;

		wp_enqueue_style(
			self::HANDLE,
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/marketing-assets.css',
			array(),
			$asset['version']
		);

		if ( ! $with_script ) {
			return;
		}

		wp_enqueue_script(
			self::HANDLE,
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/marketing-assets.js',
			$asset['dependencies'],
			$asset['version'],
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		wp_set_script_translations( self::HANDLE, 'fair-events-experimental', Features::script_translations_path() );
	}

	/**
	 * Output the document head and open the body.
	 *
	 * @param string $title  Page title, as plain text; the site name is appended.
	 * @param int    $status HTTP status.
	 * @return void
	 */
	private static function open_document( $title, $status = 200 ) {
		// The page prints its own <title>, whatever the theme supports, so
		// core's title tag is left out to avoid a second one.
		remove_action( 'wp_head', '_wp_render_title_tag', 1 );
		$document_title = sprintf(
			/* translators: 1: page title, 2: site name */
			__( '%1$s – %2$s', 'fair-events-experimental' ),
			$title,
			DisplayText::decode( get_bloginfo( 'name' ) )
		);

		status_header( $status );
		header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
		?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
		<?php // Decoded text: DisplayText::html() escapes it without a second decode (#2300). ?>
	<title><?php echo DisplayText::html( $document_title ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- DisplayText::html() escapes decoded text. ?></title>
		<?php wp_head(); ?>
</head>
<body <?php body_class( 'fair-marketing-assets-view' ); ?>>
		<?php
		wp_body_open();
	}

	/**
	 * Close the body and the document.
	 *
	 * @return void
	 */
	private static function close_document() {
		wp_footer();
		?>
</body>
</html>
		<?php
	}
}
