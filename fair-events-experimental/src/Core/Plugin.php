<?php
/**
 * Plugin core class for Fair Events Experimental
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Main plugin class implementing singleton pattern
 */
class Plugin {
	/**
	 * Single instance of the plugin
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance of the plugin
	 *
	 * @return Plugin Plugin instance
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		// This companion is never distributed on WordPress.org, so it always
		// bundles its own translation files rather than waiting on a language
		// pack that will never exist.
		add_action(
			'init',
			function () {
				load_plugin_textdomain( 'fair-events-experimental', false, 'fair-events-experimental/languages' );
			}
		);

		$this->load_admin();
		$this->load_settings();
		$this->load_rest_api();
		$this->load_meta_conversions();

		// Registered with every bundle, so the Meta credential stays
		// manageable in Connectors while delivery is off or unavailable.
		\FairEventsExperimental\Meta\Connector::init();

		// Manual WhatsApp connection: IDs, validation, one-off test sends and
		// their delivery updates from Meta's webhook, behind the `whatsapp`
		// bundle. No provider, schedule or queue is registered; see WHATSAPP.md.
		$this->load_whatsapp();

		// Instagram connection, taken over from Fair Audience; see
		// Instagram\Ownership.
		$this->load_instagram();

		// Operator links to an event feed's weekly summary; see
		// docs/weekly-summary.md.
		\FairEventsExperimental\Frontend\WeeklySummaryPage::init();

		// Merge experimental feature states into the manage-event enabledFeatures map.
		// Core owns `ticketing` (base ticket configuration); this plugin's own
		// `ticketing` setting only controls its extensions, published under a
		// key of their own so it can never overwrite core's decision.
		add_filter(
			'fair_events_enabled_features_map',
			function ( $map ) {
				foreach ( array_keys( Features::registry() ) as $key ) {
					if ( 'ticketing' === $key ) {
						continue;
					}
					$map[ $key ] = Features::is_enabled( $key );
				}
				$map['ticketingExtensions'] = self::ticketing_extensions_available();
				// Not a bundle of its own: Prices offers "Workshop schedule"
				// whenever this plugin can show the tab it enables.
				$map['schedule'] = self::schedule_available();
				return $map;
			}
		);
	}

	/**
	 * Load and initialize admin pages
	 *
	 * @return void
	 */
	private function load_admin() {
		if ( is_admin() ) {
			$admin = new \FairEventsExperimental\Admin\AdminPages();
			$admin->init();

			// Keep the independent Schedule extension available.
			if ( self::schedule_available() ) {
				add_action( 'fair_events_manage_event_enqueue_assets', array( $this, 'enqueue_manage_event_schedule_assets' ) );
			}

			if ( self::event_organizers_available() ) {
				add_action( 'fair_events_manage_event_enqueue_assets', array( $this, 'enqueue_manage_event_organizer_assets' ) );
				add_action( 'fair_events_calendar_enqueue_assets', array( $this, 'enqueue_calendar_organizer_assets' ) );
			}
		}
	}

	/**
	 * Whether the ticketing extensions (group pricing and group permission
	 * rules) are available.
	 *
	 * They build on base ticketing, so core Fair Events' `ticketing` feature
	 * must be on as well as this plugin's own `ticketing` setting, and the
	 * groups they target come from Fair Audience. Turning either setting off
	 * only hides the extensions; stored rules are kept. See
	 * docs/ticketing-availability.md.
	 *
	 * @return bool
	 */
	public static function ticketing_extensions_available() {
		return Features::is_enabled( 'ticketing' )
			&& class_exists( \FairEvents\Core\Features::class )
			&& \FairEvents\Core\Features::is_enabled( 'ticketing' )
			&& defined( 'FAIR_AUDIENCE_PLUGIN_DIR' );
	}

	/**
	 * Whether organizer management is available: the `organizers` bundle is
	 * on and the active Fair Events has the organizer with private
	 * notification recipients it builds on. Turning the bundle off only hides
	 * management; every stored organizer is kept.
	 *
	 * @return bool
	 */
	public static function organizers_available() {
		return Features::is_enabled( 'organizers' )
			&& \FairEventsExperimental\Models\OrganizerRepository::is_available();
	}

	/**
	 * Whether organizers can be assigned to events: organizer management is
	 * available and the active Fair Events stores the assignment. Turning
	 * the bundle off restores the sitewide organizer everywhere and keeps
	 * every saved assignment.
	 *
	 * @return bool
	 */
	public static function event_organizers_available() {
		return self::organizers_available()
			&& \FairEventsExperimental\Services\EventOrganizer::is_supported();
	}

	/**
	 * Whether the active Fair Events stores and serves event schedules.
	 *
	 * @return bool
	 */
	private static function schedule_available() {
		return class_exists( \FairEvents\API\EventScheduleController::class );
	}

	/**
	 * Enqueue the Schedule tab on the fair-events manage-event page.
	 *
	 * Declares `fair-events-manage-event` as a script dependency so its
	 * `addFilter()` call runs before the host bundle's `domReady()` mount.
	 *
	 * @return void
	 */
	public function enqueue_manage_event_schedule_assets() {
		$asset_file = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/admin/manage-event-schedule/index.asset.php';

		wp_enqueue_script(
			'fair-events-experimental-manage-event-schedule',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/admin/manage-event-schedule/index.js',
			array_merge( $asset_file['dependencies'], array( 'fair-events-manage-event' ) ),
			$asset_file['version'],
			true
		);

		wp_enqueue_style(
			'fair-events-experimental-manage-event-schedule',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/admin/manage-event-schedule/index.css',
			array( 'wp-components' ),
			$asset_file['version']
		);

		wp_set_script_translations( 'fair-events-experimental-manage-event-schedule', 'fair-events-experimental', Features::script_translations_path() );
	}

	/**
	 * Enqueue the organizer section of Manage Event's Event Details, for
	 * administrators only: organizers are managed by administrators.
	 *
	 * @return void
	 */
	public function enqueue_manage_event_organizer_assets() {
		$this->enqueue_organizer_script( 'manage-event-organizer', 'fair-events-manage-event' );
	}

	/**
	 * Enqueue the organizer field of the calendar's Create Event popup,
	 * for administrators only.
	 *
	 * @return void
	 */
	public function enqueue_calendar_organizer_assets() {
		$this->enqueue_organizer_script( 'calendar-organizer', 'fair-events-calendar' );
	}

	/**
	 * Enqueue an organizer script after the Fair Events page script it extends.
	 *
	 * @param string $entry       Build entry under build/admin/.
	 * @param string $host_handle Fair Events script handle it extends.
	 * @return void
	 */
	private function enqueue_organizer_script( $entry, $host_handle ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		$asset_file = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/admin/' . $entry . '/index.asset.php';
		$handle     = 'fair-events-experimental-' . $entry;

		wp_enqueue_script(
			$handle,
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/admin/' . $entry . '/index.js',
			array_merge( $asset_file['dependencies'], array( $host_handle ) ),
			$asset_file['version'],
			true
		);

		wp_set_script_translations( $handle, 'fair-events-experimental', Features::script_translations_path() );
	}

	/**
	 * Load and initialize settings
	 *
	 * @return void
	 */
	private function load_settings() {
		$settings = new \FairEventsExperimental\Settings\Settings();
		$settings->init();
	}

	/**
	 * Load and initialize REST API endpoints
	 *
	 * @return void
	 */
	private function load_rest_api() {
		if ( Features::is_enabled( 'sources' ) ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\EventSourceController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\EventProposalController();
					$controller->register_routes();
				}
			);
		}

		if ( self::organizers_available() ) {
			add_action(
				'rest_api_init',
				static function () {
					( new \FairEventsExperimental\API\OrganizersController() )->register_routes();
				}
			);
		}

		if ( self::event_organizers_available() ) {
			add_action(
				'rest_api_init',
				static function () {
					( new \FairEventsExperimental\API\EventOrganizerController() )->register_routes();
				}
			);
			// Public event JSON-LD names the event's organizer.
			\FairEventsExperimental\Services\EventOrganizer::register_hooks();
			// Fair Events' sales summaries route each event's sales to its organizer.
			\FairEventsExperimental\Services\SalesSummaryRouting::register_hooks();
		}

		if ( self::ticketing_extensions_available() ) {
			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\GroupPricingRulesController();
					$controller->register_routes();
				}
			);

			add_action(
				'rest_api_init',
				function () {
					$controller = new \FairEventsExperimental\API\GroupPermissionRulesController();
					$controller->register_routes();
				}
			);
		}
	}

	/**
	 * Claim the Instagram connection when the `instagram` feature is on and
	 * Fair Audience hands it over; then protect the token and serve the
	 * connection API. Off, the stored connection stays for Fair Audience.
	 *
	 * Unified Login tokens do not expire, so nothing renews them: the daily
	 * renewal of earlier releases is removed on every request.
	 *
	 * Runs on `plugins_loaded` (priority 5): Fair Audience asks for the
	 * claim on a later priority.
	 *
	 * @return void
	 */
	private function load_instagram() {
		add_action(
			'init',
			static function () {
				Cron::unschedule( array( \FairEventsExperimental\Instagram\Connection::REFRESH_HOOK ) );
			},
			11
		);

		if ( ! Features::is_enabled( 'instagram' ) ) {
			return;
		}

		add_action(
			'rest_api_init',
			static function () {
				( new \FairEventsExperimental\API\InstagramConnectionController() )->register_routes();
			}
		);

		if ( ! \FairEventsExperimental\Instagram\Ownership::claim() ) {
			return;
		}

		\FairEventsExperimental\Instagram\Connection::boot();
	}

	/**
	 * Load the WhatsApp connection while the `whatsapp` bundle is on: the
	 * Settings → Connectors credential, the administrator and webhook REST
	 * routes, and the delivery tables, installed and pruned daily.
	 *
	 * Off, none of it is registered and the cleanup is unscheduled. The saved
	 * IDs, credentials and delivery history stay where they are, and the
	 * credentials are not exposed anywhere, so turning the bundle back on
	 * resumes without re-entering anything.
	 *
	 * The cleanup handler is registered at once; installing and scheduling
	 * wait for `init`, after translations and the other plugins' bootstraps.
	 *
	 * @return void
	 */
	private function load_whatsapp() {
		if ( ! Features::is_enabled( 'whatsapp' ) ) {
			add_action(
				'init',
				static function () {
					Cron::unschedule( array( \FairEventsExperimental\WhatsApp\Deliveries::CLEANUP_HOOK ) );
				},
				11
			);
			return;
		}

		\FairEventsExperimental\WhatsApp\Connector::init();
		add_action(
			'rest_api_init',
			static function () {
				( new \FairEventsExperimental\API\WhatsAppController() )->register_routes();
				( new \FairEventsExperimental\API\WhatsAppWebhookController() )->register_routes();
			}
		);

		add_action(
			\FairEventsExperimental\WhatsApp\Deliveries::CLEANUP_HOOK,
			static function () {
				( new \FairEventsExperimental\WhatsApp\Deliveries() )->prune();
			}
		);
		add_action( 'init', array( \FairEventsExperimental\WhatsApp\Deliveries::class, 'maybe_install' ), 5 );
		add_action(
			'init',
			static function () {
				Cron::ensure_recurring( \FairEventsExperimental\WhatsApp\Deliveries::CLEANUP_HOOK, 'daily', time() + DAY_IN_SECONDS );
			},
			11
		);
	}

	/**
	 * Load the opt-in Meta integration. It works without Fair Payments
	 * Connector: settings, diagnostics, delivery and event-button tracking
	 * load whenever the bundle is on; only checkout and purchase measurement
	 * waits for payments (see Conversions::init()).
	 */
	private function load_meta_conversions() {
		if ( ! Features::is_enabled( 'meta-conversions' ) ) {
			// Nothing runs while the bundle is off. Queued outbox rows stay
			// and get a wake-up again once it is turned back on.
			add_action(
				'init',
				static function () {
					Cron::unschedule( Cron::META_HOOKS );
				},
				11
			);
			return;
		}

		// Before Conversions reconciles its wake-ups from the outbox (`init`, 10).
		add_action(
			'init',
			static function () {
				if ( \FairEventsExperimental\Meta\Outbox::DB_VERSION !== (string) get_option( 'fair_events_experimental_meta_db_version', '' ) ) {
					\FairEventsExperimental\Meta\Outbox::install();
				}
			},
			5
		);
		$service = new \FairEventsExperimental\Meta\Conversions();
		$service->init();
		add_action(
			'rest_api_init',
			static function () {
				( new \FairEventsExperimental\API\MetaConversionsController() )->register_routes();
				( new \FairEventsExperimental\API\MetaEngagementController() )->register_routes();
			}
		);
		add_action(
			'wp_enqueue_scripts',
			static function () {
				if ( is_singular() && has_block( 'fair-events/event-signup', get_queried_object() ) ) {
					$asset = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/frontend/meta-attribution.asset.php';
					wp_enqueue_script( 'fair-events-experimental-meta-attribution', FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/meta-attribution.js', $asset['dependencies'], $asset['version'], true );
				}
			}
		);
		add_action( 'wp_enqueue_scripts', array( $this, 'enqueue_meta_engagement' ) );
		add_action(
			'init',
			static function () {
				Cron::ensure_recurring( \FairEventsExperimental\Meta\Conversions::CLEANUP_HOOK, 'daily', time() + DAY_IN_SECONDS );
			},
			11
		);
	}

	/**
	 * Enqueue button-click capture on a public event page, bootstrapped with
	 * the page's event and the occurrence it shows. Nothing loads until Meta
	 * credentials are configured.
	 *
	 * @return void
	 */
	public function enqueue_meta_engagement() {
		if ( ! is_singular() || ! \FairEventsExperimental\Meta\Conversions::configured() ) {
			return;
		}
		$context = \FairEventsExperimental\Meta\Engagement::page_context( get_queried_object_id() );
		if ( ! $context ) {
			return;
		}
		$asset = include FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/frontend/meta-engagement.asset.php';
		wp_enqueue_script(
			'fair-events-experimental-meta-engagement',
			FAIR_EVENTS_EXPERIMENTAL_PLUGIN_URL . 'build/frontend/meta-engagement.js',
			$asset['dependencies'],
			$asset['version'],
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
		wp_add_inline_script(
			'fair-events-experimental-meta-engagement',
			'window.fairEventsMetaEngagement = ' . wp_json_encode( $context ) . ';',
			'before'
		);
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation.
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning.
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization.
	}
}
