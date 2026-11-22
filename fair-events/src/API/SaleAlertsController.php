<?php
/**
 * Telegram ticket sale alerts REST API.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Models\EventDates;
use FairEvents\Notifications\SaleAlertDispatcher;
use FairEvents\Notifications\SaleAlertLog;
use FairEvents\Notifications\SaleAlertSettings;
use FairEvents\Notifications\SalesSummaryOrganizers;
use FairEvents\Notifications\SalesSummarySettings;
use FairEvents\Notifications\TelegramConnector;
use FairEventsShared\Helpers\DisplayText;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Settings and recent outcomes of the Telegram ticket sale alerts (#2448),
 * for administrators only.
 *
 * The organizers' chats and channels are returned here, to the editor
 * that saves them, and nowhere else. Recent outcomes name the event, the
 * organizer and a reason code: never the buyer, the destination, the bot
 * token or Telegram's own error text.
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
						'enabled'    => array( 'type' => 'boolean' ),
						'organizers' => array( 'type' => 'object' ),
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
	 * Save the settings. Organizers left out keep their saved settings.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_settings( $request ) {
		$current = SaleAlertSettings::get();
		$input   = array(
			'enabled'    => null !== $request->get_param( 'enabled' ) ? $request->get_param( 'enabled' ) : $current['enabled'],
			'organizers' => null !== $request->get_param( 'organizers' ) ? $request->get_param( 'organizers' ) : array(),
		);

		$validated = SaleAlertSettings::validate( $input );
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

		SaleAlertSettings::save( $validated['settings'] );
		if ( SaleAlertSettings::enabled() ) {
			\FairEvents\Core\Cron::ensure_recurring( SaleAlertDispatcher::RECOVERY_HOOK, 'hourly', time() + HOUR_IN_SECONDS );
		}

		return rest_ensure_response( $this->payload() );
	}

	/**
	 * The page's data.
	 *
	 * @return array
	 */
	private function payload() {
		$directory  = new SalesSummaryOrganizers();
		$settings   = SaleAlertSettings::get();
		$organizers = array();
		foreach ( $directory->all() as $organizer ) {
			$organizers[] = array(
				'id'       => $organizer['id'],
				'name'     => DisplayText::decode( $organizer['name'] ),
				'sitewide' => SalesSummarySettings::DEFAULT_ORGANIZER === $organizer['id'],
				'settings' => $settings['organizers'][ $organizer['id'] ] ?? SaleAlertSettings::organizer_defaults(),
			);
		}

		$problem = TelegramConnector::problem();

		return array(
			'enabled'                        => $settings['enabled'],
			'organizers'                     => $organizers,
			'organizer_resolution_available' => $directory->resolution_available(),
			'credential_problem'             => $problem ? $problem['message'] : '',
			'connectors_url'                 => TelegramConnector::admin_url(),
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
				'created_at'     => gmdate( 'c', (int) strtotime( $row['created_at'] . ' UTC' ) ),
				'updated_at'     => gmdate( 'c', (int) strtotime( $row['updated_at'] . ' UTC' ) ),
			);
		}
		return $recent;
	}
}
