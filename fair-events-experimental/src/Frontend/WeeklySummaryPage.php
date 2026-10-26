<?php
/**
 * Public weekly-summary page for operators
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Frontend;

defined( 'WPINC' ) || die;

use FairEventsExperimental\Services\WeeklySummary;

/**
 * Serves `/fair-events-weekly-summary/{feed-slug}/`: a read-only list of the
 * week's public events of an event feed and their summary text, for an
 * operator to copy and post by hand (e.g. to a WhatsApp community).
 *
 * The event feed names the community, so each feed gets its own link. `week`
 * picks the week. Opening the page or copying sends nothing anywhere.
 */
class WeeklySummaryPage {

	/**
	 * Query variable carrying the event feed slug.
	 *
	 * @var string
	 */
	const QUERY_VAR = 'fair_weekly_summary';

	/**
	 * Path prefix of the pretty-permalink link.
	 *
	 * @var string
	 */
	const PATH = 'fair-events-weekly-summary';

	/**
	 * Option storing the version of the rewrite rules last flushed.
	 *
	 * @var string
	 */
	const RULES_OPTION = 'fair_events_experimental_weekly_summary_rules';

	/**
	 * Version of the rewrite rules; bump it when the rule changes.
	 *
	 * @var string
	 */
	const RULES_VERSION = '1';

	/**
	 * Initialize hooks.
	 *
	 * @return void
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'add_rewrite_rule' ) );
		add_filter( 'query_vars', array( __CLASS__, 'add_query_vars' ) );
		// Before redirect_canonical(), which knows nothing of this path.
		add_action( 'template_redirect', array( __CLASS__, 'handle_request' ), 1 );
	}

	/**
	 * Register the link's rewrite rule, flushing the rules once per version.
	 *
	 * @return void
	 */
	public static function add_rewrite_rule() {
		add_rewrite_rule( '^' . self::PATH . '/([^/]+)/?$', 'index.php?' . self::QUERY_VAR . '=$matches[1]', 'top' );

		if ( get_option( self::RULES_OPTION ) !== self::RULES_VERSION ) {
			flush_rewrite_rules( false );
			update_option( self::RULES_OPTION, self::RULES_VERSION );
		}
	}

	/**
	 * Remove the rewrite rule when the plugin is deactivated.
	 *
	 * The plugin is still loaded during deactivation, so the rule is taken
	 * out of this request's rules before flushing. Deleting the option makes
	 * the next activation flush the rule back in.
	 *
	 * @return void
	 */
	public static function deactivate() {
		global $wp_rewrite;

		unset( $wp_rewrite->extra_rules_top[ '^' . self::PATH . '/([^/]+)/?$' ] );
		delete_option( self::RULES_OPTION );
		flush_rewrite_rules( false );
	}

	/**
	 * Operator link for an event feed.
	 *
	 * @param string      $slug Event feed slug.
	 * @param string|null $week Optional `YYYY-Www` week.
	 * @return string
	 */
	public static function url( $slug, $week = null ) {
		global $wp_rewrite;

		if ( $wp_rewrite->using_permalinks() ) {
			$url = home_url( user_trailingslashit( $wp_rewrite->root . self::PATH . '/' . rawurlencode( $slug ) ) );
		} else {
			$url = add_query_arg( self::QUERY_VAR, rawurlencode( $slug ), home_url( '/' ) );
		}

		return null === $week ? $url : add_query_arg( 'week', rawurlencode( $week ), $url );
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
	 * Render the summary, or an unavailable page, for requests carrying the
	 * query var.
	 *
	 * @return void
	 */
	public static function handle_request() {
		$slug = (string) get_query_var( self::QUERY_VAR );
		if ( '' === $slug ) {
			return;
		}

		// Operator pages are working copies of a calendar, not content.
		add_filter( 'wp_robots', 'wp_robots_no_robots' );
		nocache_headers();

		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only public view.
		$week_raw = isset( $_GET['week'] ) ? sanitize_text_field( wp_unslash( $_GET['week'] ) ) : '';
		$summary  = ( new WeeklySummary() )->build( $slug, $week_raw );

		if ( is_wp_error( $summary ) ) {
			self::render_unavailable( $summary->get_error_message() );
			exit;
		}

		self::render( $summary, $slug, $week_raw );
		exit;
	}

	/**
	 * Output the summary page.
	 *
	 * @param array  $summary  Summary from WeeklySummary::build().
	 * @param string $slug     Event feed slug.
	 * @param string $week_raw Requested week, as given.
	 * @return void
	 */
	private static function render( array $summary, $slug, $week_raw ) {
		self::enqueue_assets();

		$week_label = sprintf(
			/* translators: 1: ISO week number, 2: ISO week-numbering year */
			__( 'Week %1$d, %2$d', 'fair-events-experimental' ),
			$summary['week'],
			$summary['year']
		);
		$prev_url = self::url( $slug, sprintf( '%04d-W%02d', $summary['prev']['year'], $summary['prev']['week'] ) );
		$next_url = self::url( $slug, sprintf( '%04d-W%02d', $summary['next']['year'], $summary['next']['week'] ) );
		$title    = sprintf(
			/* translators: 1: page title, 2: date range of the week */
			__( 'Weekly summary: %1$s, %2$s', 'fair-events-experimental' ),
			wp_strip_all_tags( $summary['title'] ),
			$summary['range']
		);

		self::open_document( $title );
		?>
	<main class="fair-weekly-summary">
		<header class="fair-weekly-summary__header">
			<p class="fair-weekly-summary__eyebrow"><?php esc_html_e( 'Weekly summary for WhatsApp', 'fair-events-experimental' ); ?></p>
			<p class="fair-weekly-summary__feed">
				<?php
				echo esc_html(
					sprintf(
						/* translators: %s: event feed name */
						__( 'Event feed: %s', 'fair-events-experimental' ),
						$summary['feed']
					)
				);
				?>
			</p>
			<h1 class="fair-weekly-summary__title"><?php echo esc_html( wp_strip_all_tags( $summary['title'] ) ); ?></h1>
			<p class="fair-weekly-summary__source"><a href="<?php echo esc_url( $summary['url'] ); ?>"><?php echo esc_html( $summary['url'] ); ?></a></p>
		</header>

		<nav class="fair-weekly-summary__week" aria-label="<?php esc_attr_e( 'Week', 'fair-events-experimental' ); ?>">
			<a class="fair-weekly-summary__nav" href="<?php echo esc_url( $prev_url ); ?>"><?php esc_html_e( 'Previous week', 'fair-events-experimental' ); ?></a>
			<p class="fair-weekly-summary__range">
				<strong><?php echo esc_html( $summary['range'] ); ?></strong>
				<span><?php echo esc_html( $week_label ); ?></span>
			</p>
			<a class="fair-weekly-summary__nav" href="<?php echo esc_url( $next_url ); ?>"><?php esc_html_e( 'Next week', 'fair-events-experimental' ); ?></a>
		</nav>

		<?php if ( ! $summary['week_valid'] && '' !== $week_raw ) : ?>
			<p class="fair-weekly-summary__notice" role="note">
				<?php
				echo esc_html(
					sprintf(
						/* translators: %s: week as given in the link, e.g. "2026-W60" */
						__( '“%s” is not a valid week, so this shows the current week.', 'fair-events-experimental' ),
						$week_raw
					)
				);
				?>
			</p>
		<?php endif; ?>

		<section class="fair-weekly-summary__section" aria-labelledby="fair-weekly-summary-events">
			<h2 id="fair-weekly-summary-events"><?php esc_html_e( 'Events this week', 'fair-events-experimental' ); ?></h2>
			<?php if ( empty( $summary['events'] ) ) : ?>
				<p class="fair-weekly-summary__notice fair-weekly-summary__empty">
					<?php esc_html_e( 'There are no public events this week. The message below has only its heading.', 'fair-events-experimental' ); ?>
				</p>
			<?php else : ?>
				<ol class="fair-weekly-summary__events">
					<?php foreach ( $summary['events'] as $event ) : ?>
						<?php $event_title = '' !== $event['title'] ? $event['title'] : __( '(untitled event)', 'fair-events-experimental' ); ?>
						<li class="fair-weekly-summary__event">
							<span class="fair-weekly-summary__when"><?php echo esc_html( $event['when'] ); ?></span>
							<?php if ( '' !== $event['url'] ) : ?>
								<a href="<?php echo esc_url( $event['url'] ); ?>"><?php echo esc_html( $event_title ); ?></a>
							<?php else : ?>
								<span><?php echo esc_html( $event_title ); ?></span>
							<?php endif; ?>
						</li>
					<?php endforeach; ?>
				</ol>
			<?php endif; ?>
		</section>

		<section
			class="fair-weekly-summary__section fair-weekly-summary__copy"
			aria-labelledby="fair-weekly-summary-text-label"
			data-copied-message="<?php esc_attr_e( 'Message copied. Paste it into WhatsApp.', 'fair-events-experimental' ); ?>"
			data-failed-message="<?php esc_attr_e( 'Couldn’t copy automatically. The message is selected below: copy it with your device’s copy command.', 'fair-events-experimental' ); ?>"
		>
			<h2 id="fair-weekly-summary-text-label"><?php esc_html_e( 'WhatsApp message', 'fair-events-experimental' ); ?></h2>
			<p class="fair-weekly-summary__hint"><?php esc_html_e( 'Copy this message, then paste it into your WhatsApp group or community. Nothing is sent automatically.', 'fair-events-experimental' ); ?></p>
			<button type="button" class="fair-weekly-summary__button wp-element-button"><?php esc_html_e( 'Copy WhatsApp message', 'fair-events-experimental' ); ?></button>
			<p class="fair-weekly-summary__status" role="status" aria-live="polite"></p>
			<?php
			// esc_html(), unlike esc_textarea(), keeps entities WordPress
			// already encoded in titles, so the browser shows the text the
			// block's own Copy summary button copies.
			?>
			<textarea class="fair-weekly-summary__text" aria-labelledby="fair-weekly-summary-text-label" readonly rows="<?php echo esc_attr( (string) min( 16, count( $summary['events'] ) + 2 ) ); ?>"><?php echo esc_html( $summary['text'] ); ?></textarea>
		</section>
	</main>
		<?php
		self::close_document();
	}

	/**
	 * Output a page explaining why the summary isn't available.
	 *
	 * @param string $message Reason, for the operator.
	 * @return void
	 */
	private static function render_unavailable( $message ) {
		self::enqueue_assets();

		self::open_document( __( 'Weekly summary unavailable', 'fair-events-experimental' ), 404 );
		?>
	<main class="fair-weekly-summary">
		<h1 class="fair-weekly-summary__title"><?php esc_html_e( 'Weekly summary unavailable', 'fair-events-experimental' ); ?></h1>
		<p class="fair-weekly-summary__notice fair-weekly-summary__notice--error" role="alert"><?php echo esc_html( $message ); ?></p>
	</main>
		<?php
		self::close_document();
	}

	/**
	 * Enqueue the page's own script and styles.
	 *
	 * @return void
	 */
	private static function enqueue_assets() {
		$asset_file = FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/frontend/weekly-summary.asset.php';
		if ( ! file_exists( $asset_file ) ) {
			return;
		}
		$asset = include $asset_file;

		wp_enqueue_style(
			'fair-events-experimental-weekly-summary',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/weekly-summary.css',
			array(),
			$asset['version']
		);
		wp_enqueue_script(
			'fair-events-experimental-weekly-summary',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/weekly-summary.js',
			$asset['dependencies'],
			$asset['version'],
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
	}

	/**
	 * Output the document head and open the body.
	 *
	 * @param string $title  Document title.
	 * @param int    $status HTTP status.
	 * @return void
	 */
	private static function open_document( $title, $status = 200 ) {
		add_filter(
			'document_title_parts',
			static function ( $parts ) use ( $title ) {
				$parts['title'] = $title;
				return $parts;
			}
		);

		status_header( $status );
		header( 'Content-Type: text/html; charset=' . get_bloginfo( 'charset' ) );
		?>
<!DOCTYPE html>
<html <?php language_attributes(); ?>>
<head>
	<meta charset="<?php bloginfo( 'charset' ); ?>">
	<meta name="viewport" content="width=device-width, initial-scale=1">
		<?php wp_head(); ?>
</head>
<body <?php body_class( 'fair-weekly-summary-view' ); ?>>
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
