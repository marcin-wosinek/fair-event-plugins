<?php
/**
 * Telegram ticket sale alerts REST API.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Models\EventDates;
use FairEvents\Notifications\SaleAlertDispatcher;
use FairEvents\Notifications\SaleAlertFormatter;
use FairEvents\Notifications\SaleAlertLog;
use FairEvents\Notifications\SaleAlertSettings;
use FairEvents\Notifications\SalesSummaryOrganizers;
use FairEvents\Notifications\SalesSummarySettings;
use FairEvents\Notifications\TelegramConnector;
use FairEvents\Notifications\TelegramProvider;
use FairEvents\Notifications\TelegramSettings;
use FairEventsShared\Helpers\DisplayText;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Settings and recent outcomes of the Telegram ticket sale alerts (#2448),
 * for administrators only, with each organizer's frequency, its next
 * digest and the sales waiting for it (#2449). Each organizer's own switch
 * turns its alerts on; a test message checks a destination before it is
 * saved or switched on.
 *
 * The organizers' chats and channels are returned here, to the editor
 * that saves them, and nowhere else. Recent outcomes name the event, the
 * organizer and a reason code: never the buyer, the destination, the bot
 * token or Telegram's own error text. Only a test message's refusal, for
 * the administrator who sent it, includes Telegram's reason, with the
 * token removed, so the destination can be fixed.
 */
class SaleAlertsController extends WP_REST_Controller {

	/**
	 * Recent outcomes listed.
	 */
	public const RECENT_LIMIT = 20;

	/**
	 * Route namespace.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-events/v1';

	/**
	 * Route base.
	 *
	 * @var string
	 */
	protected $rest_base = 'sale-alerts';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_settings' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_settings' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					// Validated together in the callback, so each field's message reaches the form.
					'args'                => array(
						'organizers' => array( 'type' => 'object' ),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/test',
			array(
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'send_test' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					// Validated in the callback with the settings' own check and message.
					'args'                => array(
						'chat_id' => array(
							'type'    => 'string',
							'default' => '',
						),
					),
				),
			)
		);
	}

	/**
	 * Only administrators manage ticket sale alerts.
	 *
	 * @return true|WP_Error
	 */
	public function permissions_check() {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage ticket sale alerts.', 'fair-events' ),
			array( 'status' => is_user_logged_in() ? 403 : 401 )
		);
	}

	/**
	 * Settings, organizers and recent outcomes.
	 *
	 * @return \WP_REST_Response
	 */
	public function get_settings() {
		return rest_ensure_response( $this->payload() );
	}

	/**
	 * Save the settings. Organizers left out keep their saved settings, and
	 * so do the fields an organizer's entry leaves out.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_settings( $request ) {
		$current    = SaleAlertSettings::get();
		$organizers = null !== $request->get_param( 'organizers' ) ? $request->get_param( 'organizers' ) : array();
		if ( is_array( $organizers ) ) {
			foreach ( $organizers as $key => $organizer ) {
				if ( is_array( $organizer ) && isset( $current['organizers'][ $key ] ) ) {
					$organizers[ $key ] = array_merge( $current['organizers'][ $key ], $organizer );
				}
			}
		}
		$validated = SaleAlertSettings::validate( array( 'organizers' => $organizers ) );
		if ( $validated['errors'] ) {
			return new WP_Error(
				'rest_invalid_param',
				implode( ' ', array_unique( $validated['errors'] ) ),
				array(
					'status' => 400,
					'params' => $validated['errors'],
				)
			);
		}

		$saved = SaleAlertSettings::save( $validated['settings'] );
		if ( SaleAlertSettings::any_enabled() ) {
			\FairEvents\Core\Cron::ensure_recurring( SaleAlertDispatcher::RECOVERY_HOOK, 'hourly', time() + HOUR_IN_SECONDS );
		}
		foreach ( array_keys( $saved['organizers'] ) as $key ) {
			SaleAlertDispatcher::reschedule_digest( (string) $key );
		}

		return rest_ensure_response( $this->payload() );
	}

	/**
	 * Send a labelled sample to a chat or channel, saved or not, with the
	 * saved bot token. Settings, schedules and sale records stay as they
	 * are, and it works while the organizer's alerts are off.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function send_test( $request ) {
		$chat_id = trim( (string) $request->get_param( 'chat_id' ) );
		if ( '' === $chat_id || ! TelegramSettings::valid_chat_id( $chat_id ) ) {
			$message = '' === $chat_id
				? __( 'Enter a chat or channel to send the test message to.', 'fair-events' )
				: __( 'Enter one chat ID (a number such as -1001234567890) or a public @channelname.', 'fair-events' );
			return new WP_Error(
				'rest_invalid_param',
				$message,
				array(
					'status' => 400,
					'params' => array( 'chat_id' => $message ),
				)
			);
		}

		$provider = new TelegramProvider();
		$problem  = $provider->credential_problem();
		if ( $problem ) {
			return new WP_Error(
				'fair_events_telegram_credential',
				$problem['message'],
				array(
					'status'         => 409,
					'reason'         => $problem['code'],
					'connectors_url' => TelegramConnector::admin_url(),
				)
			);
		}

		$result = $provider->send_html( $chat_id, SaleAlertFormatter::test_html() );
		if ( 'sent' === $result['state'] ) {
			return rest_ensure_response( array( 'sent' => true ) );
		}

		if ( 'failed' === $result['state'] ) {
			return new WP_Error(
				'fair_events_telegram_refused',
				sprintf(
					/* translators: %s: Telegram's reason, for example "Bad Request: chat not found" */
					__( 'Telegram refused the test message (%s). Check the chat or channel, and that the bot was added to it and may post there.', 'fair-events' ),
					'' !== $result['message'] ? $result['message'] : $result['code']
				),
				array(
					'status' => 502,
					'reason' => $result['code'],
				)
			);
		}

		return new WP_Error(
			'fair_events_telegram_uncertain',
			__( 'Telegram did not confirm the test message. It may still arrive: check the chat or channel before trying again.', 'fair-events' ),
			array(
				'status' => 504,
				'reason' => $result['code'],
			)
		);
	}

	/**
	 * The page's data.
	 *
	 * @return array
	 */
	private function payload() {
		$directory  = new SalesSummaryOrganizers();
		$settings   = SaleAlertSettings::get();
		$pending    = ( new SaleAlertLog() )->pending_counts();
		$organizers = array();
		foreach ( $directory->all() as $organizer ) {
			$next         = SaleAlertDispatcher::next_digest( $organizer['id'] );
			$organizers[] = array(
				'id'          => $organizer['id'],
				'name'        => DisplayText::decode( $organizer['name'] ),
				'sitewide'    => SalesSummarySettings::DEFAULT_ORGANIZER === $organizer['id'],
				'settings'    => $settings['organizers'][ $organizer['id'] ] ?? SaleAlertSettings::organizer_defaults(),
				'next_digest' => null !== $next ? gmdate( 'c', $next ) : null,
				'pending'     => (int) ( $pending[ $organizer['id'] ] ?? 0 ),
			);
		}

		$problem = TelegramConnector::problem();

		return array(
			'timezone'                       => wp_timezone_string(),
			'organizers'                     => $organizers,
			'organizer_resolution_available' => $directory->resolution_available(),
			'credential_problem'             => $problem ? $problem['message'] : '',
			'connectors_url'                 => TelegramConnector::admin_url(),
			// Where the organizers' alerts are edited: the Organizers page
			// while organizer management provides it, otherwise Settings.
			'settings_url'                   => admin_url( $directory->resolution_available() ? 'admin.php?page=fair-events-organizers' : 'admin.php?page=fair-events-settings&tab=organizer' ),
			'notifications_url'              => admin_url( 'admin.php?page=fair-events-event-notifications' ),
			'recent'                         => $this->recent( $directory ),
		);
	}

	/**
	 * The latest outcomes, newest first.
	 *
	 * @param SalesSummaryOrganizers $directory Organizer directory.
	 * @return array[]
	 */
	private function recent( SalesSummaryOrganizers $directory ) {
		$rows   = ( new SaleAlertLog() )->recent( self::RECENT_LIMIT );
		$events = $rows ? EventDates::get_by_ids( array_values( array_unique( array_filter( array_column( $rows, 'event_id' ) ) ) ) ) : array();

		$recent = array();
		foreach ( $rows as $row ) {
			$event     = $events[ $row['event_id'] ] ?? null;
			$organizer = '' !== $row['organizer_id'] ? $directory->find( $row['organizer_id'] ) : null;
			$recent[]  = array(
				'id'             => $row['id'],
				'event_id'       => $row['event_id'],
				'event_title'    => $event ? DisplayText::event_title( (string) $event->get_display_title(), __( '(untitled event)', 'fair-events' ) ) : '',
				'organizer_name' => $organizer ? DisplayText::decode( $organizer['name'] ) : '',
				'state'          => $row['state'],
				'reason'         => $row['reason'],
				'digest'         => '' !== $row['batch'],
				'created_at'     => gmdate( 'c', (int) strtotime( $row['created_at'] . ' UTC' ) ),
				'updated_at'     => gmdate( 'c', (int) strtotime( $row['updated_at'] . ' UTC' ) ),
			);
		}
		return $recent;
	}
}
