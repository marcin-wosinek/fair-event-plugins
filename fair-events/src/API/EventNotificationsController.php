<?php
/**
 * Event notifications administrator REST API.
 *
 * @package FairEvents
 */

namespace FairEvents\API;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Notifications\BulkEmailAdapter;
use FairEvents\Notifications\BulkEmailDispatcher;
use FairEvents\Notifications\BulkEmailSettings;
use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\DeliveryLog;
use FairEvents\Notifications\ExecutionHistory;
use FairEvents\Notifications\HistoryOutcome;
use FairEvents\Notifications\HistoryRecorder;
use FairEvents\Notifications\IndividualEmailDispatcher;
use FairEvents\Notifications\IndividualEmailEvents;
use FairEvents\Notifications\IndividualEmailRenderer;
use FairEvents\Notifications\IndividualEmailSettings;
use FairEvents\Notifications\Ownership;
use FairEvents\Notifications\SummaryBuilder;
use FairEvents\Notifications\TelegramConnector;
use FairEvents\Notifications\TelegramDispatcher;
use FairEvents\Notifications\TelegramProvider;
use FairEvents\Notifications\TelegramSettings;
use FairEvents\Notifications\WeekSchedule;
use FairEvents\Services\EmailService;
use FairEvents\Services\EventsWeekSummary;
use FairEvents\Services\WeeklyEventsProvider;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Request;
use WP_REST_Server;

defined( 'WPINC' ) || die;

/**
 * Settings, preview, test and status routes for weekly event notifications.
 *
 * Every notification configuration has its own routes under
 * `configurations/{id}`, so saving or testing one never touches another.
 * Configurations are created here with a server-generated ID and start
 * paused; their type never changes. The type routes (`telegram`,
 * `bulk-email`, `individual-email`) remain for compatibility and manage only
 * the configuration that took over that type's former single settings.
 *
 * A type this plugin does not run on this request (its former owner still
 * sends it, or the plugin that delivers it is inactive) is read-only: its
 * saved settings stay as they are and no configuration of it is added.
 *
 * The individual email is sent by this plugin alone, to one address an
 * administrator typed in. That address is only ever returned by these
 * administrator-only routes.
 *
 * The Telegram bot token is managed in Settings → Connectors. Responses report
 * only whether one is configured and where it comes from, and provider errors
 * are returned with the token removed.
 */
class EventNotificationsController extends WP_REST_Controller {

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
	protected $rest_base = 'event-notifications';

	/**
	 * Register routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		$schedule_args   = array(
			'enabled'     => array( 'type' => 'boolean' ),
			'source_slug' => array( 'type' => 'string' ),
			'day_of_week' => array(
				'type'    => 'integer',
				'minimum' => 1,
				'maximum' => 7,
			),
			'time_of_day' => array(
				'type'              => 'string',
				'validate_callback' => array( $this, 'validate_time' ),
			),
			'week_scope'  => array(
				'type' => 'string',
				'enum' => TelegramSettings::WEEK_SCOPES,
			),
		);
		$telegram_args   = array(
			'page_id'  => array(
				'type'    => 'integer',
				'minimum' => 0,
			),
			'chat_ids' => array(
				'type'  => array( 'array', 'string' ),
				'items' => array( 'type' => 'string' ),
			),
		);
		$email_args      = array(
			'skip_empty' => array( 'type' => 'boolean' ),
			'subject'    => array(
				'type'              => 'string',
				'sanitize_callback' => 'sanitize_text_field',
			),
			'intro'      => array(
				'type'              => 'string',
				'sanitize_callback' => 'wp_kses_post',
			),
			'outro'      => array(
				'type'              => 'string',
				'sanitize_callback' => 'wp_kses_post',
			),
		);
		$individual_args = array(
			// Checked in the callback, so its message reaches the page.
			'recipient'       => array( 'type' => 'string' ),
			'event_selection' => array(
				'type'              => 'string',
				'validate_callback' => array( $this, 'validate_event_selection' ),
			),
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_item' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/telegram',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'update_telegram' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => $schedule_args + array(
					'page_id'  => array(
						'type'    => 'integer',
						'minimum' => 0,
					),
					'chat_ids' => array(
						'type'  => array( 'array', 'string' ),
						'items' => array( 'type' => 'string' ),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/telegram/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview_telegram' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/telegram/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_telegram' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/bulk-email',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'update_bulk_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => $schedule_args + array(
					'skip_empty' => array( 'type' => 'boolean' ),
					'subject'    => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'intro'      => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
					'outro'      => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/bulk-email/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview_bulk_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/bulk-email/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_bulk_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/individual-email',
			array(
				'methods'             => WP_REST_Server::EDITABLE,
				'callback'            => array( $this, 'update_individual_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array_diff_key( $schedule_args, array( 'source_slug' => true ) ) + array(
					// Checked in the callback, so its message reaches the page.
					'recipient'       => array( 'type' => 'string' ),
					'event_selection' => array(
						'type'              => 'string',
						'validate_callback' => array( $this, 'validate_event_selection' ),
					),
					'skip_empty'      => array( 'type' => 'boolean' ),
					'subject'         => array(
						'type'              => 'string',
						'sanitize_callback' => 'sanitize_text_field',
					),
					'intro'           => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
					'outro'           => array(
						'type'              => 'string',
						'sanitize_callback' => 'wp_kses_post',
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/individual-email/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview_individual_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/individual-email/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_individual_email' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		$configuration = '/' . $this->rest_base . '/configurations/(?P<id>[a-z0-9_-]{1,36})';

		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/configurations',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'create_configuration' ),
				'permission_callback' => array( $this, 'permissions_check' ),
				'args'                => array(
					'type' => array(
						'type'     => 'string',
						'enum'     => Configurations::TYPES,
						'required' => true,
					),
					'name' => array( 'type' => 'string' ),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$configuration,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_configuration' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_configuration' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					// Every type's fields; each type reads only its own.
					'args'                => $schedule_args + $telegram_args + $email_args + $individual_args + array(
						'name' => array( 'type' => 'string' ),
						// Checked in the callback: a configuration's type never changes.
						'type' => array( 'type' => 'string' ),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			$configuration . '/preview',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'preview_configuration' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			$configuration . '/test',
			array(
				'methods'             => WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'test_configuration' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);

		register_rest_route(
			$this->namespace,
			$configuration . '/history',
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'configuration_history' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
	}

	/**
	 * Only administrators manage notifications.
	 *
	 * @return bool|WP_Error
	 */
	public function permissions_check() {
		if ( current_user_can( 'manage_options' ) ) {
			return true;
		}

		return new WP_Error(
			'rest_forbidden',
			__( 'You do not have permission to manage event notifications.', 'fair-events' ),
			array( 'status' => is_user_logged_in() ? 403 : 401 )
		);
	}

	/**
	 * Validate a 'HH:MM' time.
	 *
	 * @param mixed $value Time.
	 * @return true|WP_Error
	 */
	public function validate_time( $value ) {
		return TelegramSettings::valid_time( $value )
			? true
			: new WP_Error( 'invalid_time', __( 'Enter the send time as HH:MM, for example 09:00.', 'fair-events' ), array( 'status' => 400 ) );
	}

	/**
	 * Validate the individual email's event selection.
	 *
	 * @param mixed $value Selection.
	 * @return true|WP_Error
	 */
	public function validate_event_selection( $value ) {
		return IndividualEmailSettings::valid_selection( $value )
			? true
			: new WP_Error( 'invalid_event_selection', __( 'Choose which events to include.', 'fair-events' ), array( 'status' => 400 ) );
	}

	/**
	 * Read every configuration's settings and delivery status.
	 *
	 * `channels` holds, per type, the configuration the type routes manage.
	 *
	 * @param WP_REST_Request|null $request Request, unused.
	 * @return \WP_REST_Response
	 */
	public function get_item( $request = null ) {
		unset( $request );

		$configurations = array();
		$page_ids       = array();
		foreach ( $this->summarized( Configurations::all() ) as $payload ) {
			$configurations[ $payload['id'] ] = $payload;
			if ( Configurations::TELEGRAM === $payload['type'] && $payload['page_id'] ) {
				$page_ids[] = $payload['page_id'];
			}
		}

		$channels = array();
		$types    = array();
		foreach ( Configurations::TYPES as $type ) {
			$id                = Configurations::legacy_id( $type );
			$channels[ $type ] = $configurations[ $id ] ?? $this->configuration_payload(
				array(
					'id'   => $id,
					'type' => $type,
					'name' => '',
				)
			);
			$state             = $this->type_state( $type );
			$types[ $type ]    = array(
				'state'         => $state['state'],
				'state_message' => $state['message'],
			);
		}

		return rest_ensure_response(
			array(
				'sources'        => $this->sources(),
				'pages'          => $this->pages( array_unique( $page_ids ) ),
				'types'          => $types,
				'configurations' => array_values( $configurations ),
				'channels'       => $channels,
			)
		);
	}

	/**
	 * Add a configuration. It starts paused, with the type's defaults.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function create_configuration( $request ) {
		$type        = (string) $request->get_param( 'type' );
		$unavailable = $this->type_unavailable( $type );
		if ( $unavailable ) {
			return $unavailable;
		}

		$record = Configurations::create( $type, (string) $request->get_param( 'name' ), $this->default_settings( $type ) );
		if ( ! $record ) {
			return new WP_Error(
				'configuration_not_created',
				__( 'The notification could not be added. Please try again.', 'fair-events' ),
				array( 'status' => 500 )
			);
		}

		$response = rest_ensure_response( $this->summarized( array( $record ) )[0] );
		$response->set_status( 201 );
		return $response;
	}

	/**
	 * Read one configuration.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_configuration( $request ) {
		$record = $this->find_configuration( $request );
		if ( is_wp_error( $record ) ) {
			return $record;
		}

		return rest_ensure_response( $this->summarized( array( $record ) )[0] );
	}

	/**
	 * Save one configuration's name and settings.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_configuration( $request ) {
		$record = $this->find_configuration( $request );
		if ( is_wp_error( $record ) ) {
			return $record;
		}
		if ( $request->has_param( 'type' ) && $request->get_param( 'type' ) !== $record['type'] ) {
			return new WP_Error(
				'configuration_type_immutable',
				__( 'A notification’s kind cannot be changed. Add a new notification instead. Nothing was saved.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$error = $this->type_unavailable( $record['type'] );
		if ( ! $error ) {
			$error = $this->save_settings( $record['id'], $record['type'], $request );
		}
		if ( $error ) {
			return $error;
		}
		if ( $request->has_param( 'name' ) ) {
			Configurations::update( $record['id'], array( 'name' => $request->get_param( 'name' ) ) );
		}

		return rest_ensure_response( $this->summarized( array( Configurations::get( $record['id'] ) ) )[0] );
	}

	/**
	 * Preview what one configuration's next send would deliver.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_configuration( $request ) {
		$record = $this->find_configuration( $request );
		if ( is_wp_error( $record ) ) {
			return $record;
		}

		switch ( $record['type'] ) {
			case Configurations::TELEGRAM:
				return $this->preview_telegram_configuration( $record['id'] );
			case Configurations::BULK_EMAIL:
				return $this->preview_bulk_email_configuration( $record['id'] );
			default:
				return $this->preview_individual_email_configuration( $record['id'] );
		}
	}

	/**
	 * Send one configuration's test.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_configuration( $request ) {
		$record = $this->find_configuration( $request );
		if ( is_wp_error( $record ) ) {
			return $record;
		}

		switch ( $record['type'] ) {
			case Configurations::TELEGRAM:
				return $this->test_telegram_configuration( $record['id'] );
			case Configurations::BULK_EMAIL:
				return $this->test_bulk_email_configuration( $record['id'] );
			default:
				return $this->test_individual_email_configuration( $record['id'] );
		}
	}

	/**
	 * One configuration's next send, run history and delivery records.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function configuration_history( $request ) {
		$record = $this->find_configuration( $request );
		if ( is_wp_error( $record ) ) {
			return $record;
		}
		$payload = $this->configuration_payload( $record );

		return rest_ensure_response(
			array(
				'id'         => $record['id'],
				'next_run'   => $payload['next_run'],
				'runs'       => $payload['runs'],
				'deliveries' => $payload['deliveries'] ?? array(),
			)
		);
	}

	/**
	 * Save the Telegram configuration the type routes manage.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_telegram( $request ) {
		return $this->update_legacy( Configurations::TELEGRAM, $request );
	}

	/**
	 * Preview the Telegram configuration the type routes manage.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_telegram() {
		return $this->preview_telegram_configuration( Configurations::legacy_id( Configurations::TELEGRAM ) );
	}

	/**
	 * Test the Telegram configuration the type routes manage.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_telegram() {
		return $this->test_telegram_configuration( Configurations::legacy_id( Configurations::TELEGRAM ) );
	}

	/**
	 * Save the bulk email configuration the type routes manage.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_bulk_email( $request ) {
		return $this->update_legacy( Configurations::BULK_EMAIL, $request );
	}

	/**
	 * Preview the bulk email configuration the type routes manage.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_bulk_email() {
		return $this->preview_bulk_email_configuration( Configurations::legacy_id( Configurations::BULK_EMAIL ) );
	}

	/**
	 * Test the bulk email configuration the type routes manage.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_bulk_email() {
		return $this->test_bulk_email_configuration( Configurations::legacy_id( Configurations::BULK_EMAIL ) );
	}

	/**
	 * Save the individual email configuration the type routes manage.
	 *
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_individual_email( $request ) {
		return $this->update_legacy( Configurations::INDIVIDUAL_EMAIL, $request );
	}

	/**
	 * Preview the individual email configuration the type routes manage.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function preview_individual_email() {
		return $this->preview_individual_email_configuration( Configurations::legacy_id( Configurations::INDIVIDUAL_EMAIL ) );
	}

	/**
	 * Test the individual email configuration the type routes manage.
	 *
	 * @return \WP_REST_Response|WP_Error
	 */
	public function test_individual_email() {
		return $this->test_individual_email_configuration( Configurations::legacy_id( Configurations::INDIVIDUAL_EMAIL ) );
	}

	/**
	 * Save through a type route: the type's migrated configuration only.
	 *
	 * @param string          $type    Notification type.
	 * @param WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error The whole page payload, as before configurations had IDs.
	 */
	private function update_legacy( $type, $request ) {
		$error = $this->type_unavailable( $type );
		if ( $error ) {
			return $error;
		}

		$id = Configurations::legacy_id( $type );
		if ( ! Configurations::exists( $id, $type ) && ! Configurations::create( $type, '', $this->default_settings( $type ), $id ) ) {
			return new WP_Error( 'configuration_not_created', __( 'The notification could not be saved. Please try again.', 'fair-events' ), array( 'status' => 500 ) );
		}

		$error = $this->save_settings( $id, $type, $request );
		return $error ? $error : $this->get_item();
	}

	/**
	 * Validate and save one configuration's settings, then reschedule it when needed.
	 *
	 * @param string          $id      Configuration ID.
	 * @param string          $type    Its type.
	 * @param WP_REST_Request $request Request.
	 * @return WP_Error|null Why nothing was saved, or null.
	 */
	private function save_settings( $id, $type, $request ) {
		switch ( $type ) {
			case Configurations::TELEGRAM:
				return $this->save_telegram( $id, $request );
			case Configurations::BULK_EMAIL:
				return $this->save_bulk_email( $id, $request );
			default:
				return $this->save_individual_email( $id, $request );
		}
	}

	/**
	 * Save one Telegram configuration.
	 *
	 * @param string          $id      Configuration ID.
	 * @param WP_REST_Request $request Request.
	 * @return WP_Error|null
	 */
	private function save_telegram( $id, $request ) {
		// The token lives in Connectors; never treat it as a setting here.
		if ( $request->has_param( 'telegram_bot_token' ) || $request->has_param( 'bot_token' ) ) {
			return new WP_Error(
				'token_managed_in_connectors',
				__( 'The Telegram bot token is managed in Settings → Connectors. Nothing was saved.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$settings = TelegramSettings::get( $id );
		$previous = $settings;

		foreach ( array( 'source_slug', 'page_id', 'day_of_week', 'time_of_day', 'week_scope' ) as $field ) {
			if ( $request->has_param( $field ) ) {
				$settings[ $field ] = $request->get_param( $field );
			}
		}
		// One switch for the administrator; both stored flags follow it.
		if ( $request->has_param( 'enabled' ) ) {
			$settings['enabled']                          = (bool) $request->get_param( 'enabled' );
			$settings['providers']['telegram']['enabled'] = $settings['enabled'];
		}

		if ( $request->has_param( 'chat_ids' ) ) {
			$chat_ids = TelegramSettings::parse_chat_ids( $request->get_param( 'chat_ids' ) );
			$invalid  = array_filter(
				$chat_ids,
				static function ( $chat_id ) {
					return ! TelegramSettings::valid_chat_id( $chat_id );
				}
			);
			if ( $invalid ) {
				return new WP_Error(
					'invalid_chat_ids',
					sprintf(
						/* translators: %s: comma-separated list of the rejected identifiers */
						__( 'These are not Telegram chat IDs or @channel usernames: %s', 'fair-events' ),
						implode( ', ', array_map( 'sanitize_text_field', $invalid ) )
					),
					array( 'status' => 400 )
				);
			}
			if ( count( $chat_ids ) > TelegramSettings::MAX_CHAT_IDS ) {
				return new WP_Error(
					'too_many_chat_ids',
					sprintf(
						/* translators: %d: maximum number of Telegram destinations */
						__( 'Enter at most %d Telegram chats or channels.', 'fair-events' ),
						TelegramSettings::MAX_CHAT_IDS
					),
					array( 'status' => 400 )
				);
			}
			$settings['providers']['telegram']['chat_ids'] = $chat_ids;
		}

		$settings = TelegramSettings::normalize( $settings );

		if ( self::telegram_on( $settings ) ) {
			$check = ( new SummaryBuilder() )->check( $settings['source_slug'], $settings['page_id'] );
			if ( is_wp_error( $check ) ) {
				return new WP_Error( $check->get_error_code(), $check->get_error_message(), array( 'status' => 400 ) );
			}
			$provider = new TelegramProvider();
			if ( ! $provider->destinations( $settings ) ) {
				$problem = $provider->configuration_error( $settings );
				return new WP_Error(
					'no_destination',
					'' !== $problem
						? $problem
						: __( 'Before turning on Telegram summaries, add a bot token in Settings → Connectors and save at least one chat or channel.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
		}

		TelegramSettings::save( $id, $settings );

		if ( self::schedule_changed( array( 'enabled', 'day_of_week', 'time_of_day', 'week_scope' ), $previous, $settings )
			|| ( $settings['enabled'] && ! TelegramDispatcher::next_run( $id ) ) ) {
			TelegramDispatcher::reschedule( $id, $settings );
		}

		return null;
	}

	/**
	 * Save one bulk email configuration.
	 *
	 * @param string          $id      Configuration ID.
	 * @param WP_REST_Request $request Request.
	 * @return WP_Error|null
	 */
	private function save_bulk_email( $id, $request ) {
		$settings = BulkEmailSettings::stored( $id );
		$previous = $settings;
		foreach ( array_keys( BulkEmailSettings::defaults() ) as $field ) {
			if ( $request->has_param( $field ) ) {
				$settings[ $field ] = $request->get_param( $field );
			}
		}
		$settings = BulkEmailSettings::sanitize( $settings );

		if ( $settings['enabled'] ) {
			$source = '' !== $settings['source_slug'] ? ( new EventSourceRepository() )->get_by_slug( $settings['source_slug'] ) : null;
			if ( ! $source || empty( $source['enabled'] ) ) {
				return new WP_Error(
					'invalid_source',
					'' === $settings['source_slug']
						? __( 'Choose an event feed before turning on the weekly email.', 'fair-events' )
						: __( 'The selected event feed does not exist or is disabled.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
		}

		BulkEmailSettings::save( $id, $settings );

		if ( self::schedule_changed( array( 'enabled', 'day_of_week', 'time_of_day' ), $previous, $settings )
			|| ( $settings['enabled'] && ! BulkEmailDispatcher::next_run( $id ) ) ) {
			BulkEmailDispatcher::reschedule( $id, $settings );
		}

		return null;
	}

	/**
	 * Save one individual email configuration.
	 *
	 * @param string          $id      Configuration ID.
	 * @param WP_REST_Request $request Request.
	 * @return WP_Error|null
	 */
	private function save_individual_email( $id, $request ) {
		// Refused as a whole: a list or an address with extra headers is never
		// trimmed down to something that could be saved.
		if ( $request->has_param( 'recipient' ) && null === IndividualEmailSettings::parse_recipient( $request->get_param( 'recipient' ) ) ) {
			return new WP_Error(
				'invalid_recipient',
				__( 'Enter exactly one email address, for example name@example.com. Nothing was saved.', 'fair-events' ),
				array( 'status' => 400 )
			);
		}

		$settings = IndividualEmailSettings::stored( $id );
		$previous = $settings;
		foreach ( array_keys( IndividualEmailSettings::defaults() ) as $field ) {
			if ( $request->has_param( $field ) ) {
				$settings[ $field ] = $request->get_param( $field );
			}
		}
		$settings = IndividualEmailSettings::sanitize( $settings );

		if ( $settings['enabled'] ) {
			if ( '' === $settings['recipient'] ) {
				return new WP_Error(
					'missing_recipient',
					__( 'Enter the email address that receives the weekly email before turning it on.', 'fair-events' ),
					array( 'status' => 400 )
				);
			}
			$check = ( new IndividualEmailEvents() )->check( $settings['event_selection'] );
			if ( is_wp_error( $check ) ) {
				return new WP_Error( $check->get_error_code(), $check->get_error_message(), array( 'status' => 400 ) );
			}
		}

		IndividualEmailSettings::save( $id, $settings );

		if ( self::schedule_changed( array( 'enabled', 'day_of_week', 'time_of_day' ), $previous, $settings )
			|| ( $settings['enabled'] && ! IndividualEmailDispatcher::next_run( $id ) ) ) {
			IndividualEmailDispatcher::reschedule( $id, $settings );
		}

		return null;
	}

	/**
	 * Whether any schedule field differs between two settings arrays.
	 *
	 * @param string[] $fields   Schedule fields.
	 * @param array    $previous Settings before the save.
	 * @param array    $settings Saved settings.
	 * @return bool
	 */
	private static function schedule_changed( array $fields, array $previous, array $settings ) {
		foreach ( $fields as $field ) {
			if ( $previous[ $field ] !== $settings[ $field ] ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Preview a Telegram configuration's week relative to today in the site timezone.
	 *
	 * @param string $id Configuration ID.
	 * @return \WP_REST_Response|WP_Error
	 */
	private function preview_telegram_configuration( $id ) {
		$summary = $this->compose_test_summary( $id );
		if ( is_wp_error( $summary ) ) {
			return $summary;
		}
		$messages = ( new TelegramProvider() )->split( $summary );

		return rest_ensure_response(
			array(
				'week_start'       => $summary['week']['start'],
				'week_end'         => $summary['week']['end'],
				'week_title'       => EventsWeekSummary::range_title( $summary['week']['start'], $summary['week']['end'] ),
				'occurrence_count' => $summary['occurrence_count'],
				'messages'         => $messages,
			)
		);
	}

	/**
	 * Send a Telegram configuration's selected week to each of its saved
	 * chats, with the credential currently in effect.
	 *
	 * Test sends are not delivery records and do not affect scheduled sends.
	 * Each is an execution of its own in the notification history.
	 *
	 * @param string $id Configuration ID.
	 * @return \WP_REST_Response|WP_Error
	 */
	private function test_telegram_configuration( $id ) {
		$recorder    = HistoryRecorder::test( new ExecutionHistory(), $id, Configurations::TELEGRAM );
		$unavailable = $this->type_unavailable( Configurations::TELEGRAM );
		if ( $unavailable ) {
			return $this->test_refused( $recorder, $unavailable );
		}

		// Refused before anything is built or sent, so no request reaches Telegram.
		$problem = TelegramConnector::problem();
		if ( $problem ) {
			return $this->test_refused( $recorder, new WP_Error( $problem['code'], $problem['message'], array( 'status' => 400 ) ) );
		}

		$provider     = new TelegramProvider();
		$destinations = $provider->destinations( TelegramSettings::get( $id ), true );
		if ( ! $destinations ) {
			return $this->test_refused( $recorder, new WP_Error( 'missing_chat_ids', __( 'Save at least one Telegram chat or channel before sending a test message.', 'fair-events' ), array( 'status' => 400 ) ) );
		}

		$summary = $this->compose_test_summary( $id );
		if ( is_wp_error( $summary ) ) {
			return $this->test_refused( $recorder, $summary );
		}
		$recorder->cover( $summary['week'] );
		if ( 0 === $summary['occurrence_count'] ) {
			return $this->test_refused( $recorder, new WP_Error( 'no_events', __( 'There are no events in the selected week, so there is nothing to send.', 'fair-events' ), array( 'status' => 400 ) ) );
		}

		$messages = $provider->split( $summary );
		$count    = count( $messages );
		$results  = array();
		foreach ( $destinations as $destination ) {
			// Stop at the first part that is not sent, so parts never arrive out of order.
			$result = array();
			foreach ( $messages as $index => $message ) {
				$delivery = $recorder->attempt( $destination, $index + 1, $count );
				$result   = $provider->send( $destination, $message );
				$recorder->settle( $delivery, HistoryOutcome::from_state( $result['state'] ), $result['code'] );
				if ( 'sent' !== $result['state'] ) {
					for ( $rest = $index + 2; $rest <= $count; $rest++ ) {
						$recorder->note( $destination, HistoryOutcome::SKIPPED, 'previous_part_not_sent', $rest, $count );
					}
					break;
				}
			}
			$results[] = array(
				'destination' => $destination,
				'state'       => $result['state'],
				'message'     => $result['message'],
			);
		}
		$recorder->finish();

		return rest_ensure_response(
			array(
				'success' => ! array_filter(
					$results,
					static function ( $result ) {
						return 'sent' !== $result['state'];
					}
				),
				'parts'   => count( $messages ),
				'results' => $results,
			)
		);
	}

	/**
	 * Preview the weekly email a bulk email configuration's next send would deliver.
	 *
	 * @param string $id Configuration ID.
	 * @return \WP_REST_Response|WP_Error
	 */
	private function preview_bulk_email_configuration( $id ) {
		$email = $this->compose_test_email( $id );
		if ( is_wp_error( $email ) ) {
			return $email;
		}

		return rest_ensure_response( $email );
	}

	/**
	 * Send a bulk email configuration's email to the current administrator only.
	 *
	 * A test never counts as the week's send.
	 *
	 * @param string $id Configuration ID.
	 * @return \WP_REST_Response|WP_Error
	 */
	private function test_bulk_email_configuration( $id ) {
		$recorder = HistoryRecorder::test( new ExecutionHistory(), $id, Configurations::BULK_EMAIL );
		$email    = $this->compose_test_email( $id );
		if ( is_wp_error( $email ) ) {
			return $this->test_refused( $recorder, $email );
		}
		$recorder->cover(
			array(
				'start' => $email['week_start'],
				'end'   => $email['week_end'],
			)
		);

		$recipient = wp_get_current_user()->user_email;
		$delivery  = $recorder->attempt( $recipient );
		$sent      = ( new BulkEmailAdapter() )->send_test( $recipient, $email['subject'], $email['html'] );
		$recorder->settle( $delivery, $sent ? HistoryOutcome::ACCEPTED : HistoryOutcome::FAILED, $sent ? '' : 'send_failed' );
		$recorder->finish();
		if ( ! $sent ) {
			return new WP_Error(
				'send_failed',
				sprintf(
					/* translators: %s: email address */
					__( 'The test email to %s could not be sent.', 'fair-events' ),
					$recipient
				),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response( array( 'sent_to' => $recipient ) );
	}

	/**
	 * Preview the email an individual email configuration's next send would
	 * deliver, and to whom.
	 *
	 * @param string $id Configuration ID.
	 * @return \WP_REST_Response|WP_Error
	 */
	private function preview_individual_email_configuration( $id ) {
		$email = $this->compose_test_individual_email( $id );
		if ( is_wp_error( $email ) ) {
			return $email;
		}

		return rest_ensure_response( $email );
	}

	/**
	 * Send an individual email configuration's email to its saved address only.
	 *
	 * Works while the schedule is off. A test never counts as the week's
	 * send and does not move the next scheduled one.
	 *
	 * @param string $id Configuration ID.
	 * @return \WP_REST_Response|WP_Error
	 */
	private function test_individual_email_configuration( $id ) {
		$recorder = HistoryRecorder::test( new ExecutionHistory(), $id, Configurations::INDIVIDUAL_EMAIL );
		$email    = $this->compose_test_individual_email( $id );
		if ( is_wp_error( $email ) ) {
			return $this->test_refused( $recorder, $email );
		}
		$recorder->cover(
			array(
				'start' => $email['week_start'],
				'end'   => $email['week_end'],
			)
		);

		$recipient = $email['recipient'];
		if ( '' === $recipient ) {
			return $this->test_refused( $recorder, new WP_Error( 'missing_recipient', __( 'Save the email address that receives the weekly email before sending a test.', 'fair-events' ), array( 'status' => 400 ) ) );
		}

		$delivery = $recorder->attempt( $recipient );
		try {
			$sent = ( new EmailService() )->send_notification( $recipient, $email['subject'], $email['html'] );
			$recorder->settle( $delivery, $sent ? HistoryOutcome::ACCEPTED : HistoryOutcome::FAILED, $sent ? '' : 'send_failed' );
		} catch ( \Throwable $e ) {
			// The email may have gone out before the error.
			$sent = false;
			$recorder->settle( $delivery, HistoryOutcome::UNKNOWN, 'internal_error' );
		}
		$recorder->finish();
		if ( ! $sent ) {
			return new WP_Error(
				'send_failed',
				sprintf(
					/* translators: %s: email address */
					__( 'The test email to %s could not be sent.', 'fair-events' ),
					$recipient
				),
				array( 'status' => 500 )
			);
		}

		return rest_ensure_response(
			array(
				'sent_to' => $recipient,
				'empty'   => $email['empty'],
			)
		);
	}

	/**
	 * Record a test that stopped before anything was sent, and return why.
	 *
	 * A week without events is a skip; anything else is a failure.
	 *
	 * @param HistoryRecorder $recorder Test execution.
	 * @param WP_Error        $error    Why the test stopped.
	 * @return WP_Error
	 */
	private function test_refused( HistoryRecorder $recorder, WP_Error $error ) {
		$code = (string) $error->get_error_code();
		$recorder->finish( 'no_events' === $code ? HistoryOutcome::SKIPPED : HistoryOutcome::FAILURE, $code );
		return $error;
	}

	/**
	 * The configuration a request names.
	 *
	 * @param WP_REST_Request $request Request with an `id`.
	 * @return array|WP_Error The record, or a 404.
	 */
	private function find_configuration( $request ) {
		$record = Configurations::get( (string) $request->get_param( 'id' ) );
		if ( ! $record ) {
			return new WP_Error(
				'unknown_configuration',
				__( 'This notification does not exist.', 'fair-events' ),
				array( 'status' => 404 )
			);
		}
		return $record;
	}

	/**
	 * Settings a new configuration of a type starts with: the defaults, paused.
	 *
	 * @param string $type Notification type.
	 * @return array
	 */
	private function default_settings( $type ) {
		switch ( $type ) {
			case Configurations::TELEGRAM:
				return TelegramSettings::defaults();
			case Configurations::BULK_EMAIL:
				return BulkEmailSettings::defaults();
			default:
				return IndividualEmailSettings::defaults();
		}
	}

	/**
	 * One configuration's settings and delivery status, with its ID, type and name.
	 *
	 * @param array $record Configuration record.
	 * @return array
	 */
	private function configuration_payload( array $record ) {
		switch ( $record['type'] ) {
			case Configurations::TELEGRAM:
				$payload = $this->telegram_channel( $record['id'] );
				break;
			case Configurations::BULK_EMAIL:
				$payload = $this->bulk_email_channel( $record['id'] );
				break;
			default:
				$payload = $this->individual_email_channel( $record['id'] );
		}

		return array_merge(
			array(
				'id'   => $record['id'],
				'type' => $record['type'],
				'name' => $record['name'],
			),
			$payload
		);
	}

	/**
	 * Configuration payloads with each one's newest execution, read in one
	 * query for all of them.
	 *
	 * `latest_execution` is shaped like an execution of the history routes,
	 * or null before the first one. It comes from the unified history only.
	 *
	 * @param array[] $records Configuration records.
	 * @return array[]
	 */
	private function summarized( array $records ) {
		$latest  = ( new ExecutionHistory() )->latest( array_column( $records, 'id' ) );
		$history = new NotificationHistoryController();

		return array_map(
			function ( $record ) use ( $latest, $history ) {
				return array_merge(
					$this->configuration_payload( $record ),
					array(
						'latest_execution' => isset( $latest[ $record['id'] ] )
							? $history->execution_payload( $latest[ $record['id'] ] )
							: null,
					)
				);
			},
			$records
		);
	}

	/**
	 * Whether this plugin runs a type on this request, and if not, why.
	 *
	 * @param string $type Notification type.
	 * @return array{state: string, message: string}
	 */
	private function type_state( $type ) {
		if ( Configurations::TELEGRAM === $type ) {
			$owned = Ownership::owns( Ownership::TELEGRAM );
			return array(
				'state'   => $owned ? 'active' : 'update_required',
				'message' => $owned ? '' : __( 'Telegram summaries are still sent by an older Fair Events Experimental. Update Fair Events Experimental to manage them here; until then they keep running from its settings.', 'fair-events' ),
			);
		}

		if ( Configurations::BULK_EMAIL === $type ) {
			$availability = ( new BulkEmailAdapter() )->availability();
			$owned        = Ownership::owns( Ownership::BULK_EMAIL );
			$state        = $owned || BulkEmailAdapter::ACTIVE !== $availability ? $availability : BulkEmailAdapter::UPDATE_REQUIRED;
			$messages     = array(
				BulkEmailAdapter::ACTIVE          => '',
				BulkEmailAdapter::INACTIVE        => __( 'The weekly email is paused because Fair Audience is not active. Fair Audience decides who receives it and sends it. Your settings are kept and sending resumes at the next scheduled time once Fair Audience is active again.', 'fair-events' ),
				BulkEmailAdapter::UPDATE_REQUIRED => __( 'The weekly email is still sent by an older Fair Audience. Update Fair Audience to manage it here; until then it keeps running from the Weekly Digest page.', 'fair-events' ),
			);
			if ( BulkEmailAdapter::UPDATE_REQUIRED === $state && ( new BulkEmailAdapter() )->needs_reporting_update() ) {
				$messages[ $state ] = __( 'The weekly email is paused until Fair Audience is updated: this version of Fair Events records whether each subscriber’s email was sent, which needs a newer Fair Audience. Your settings are kept and sending resumes at the next scheduled time after the update.', 'fair-events' );
			}
			if ( BulkEmailAdapter::UPDATE_REQUIRED === $state && ( new BulkEmailAdapter() )->needs_feed_update() ) {
				$messages[ $state ] = __( 'The weekly email is paused until Fair Audience is updated: this version of Fair Events sends each feed’s email only to the subscribers who chose that feed, which needs a newer Fair Audience. Your settings are kept and sending resumes at the next scheduled time after the update.', 'fair-events' );
			}
			return array(
				'state'   => $state,
				'message' => $messages[ $state ],
			);
		}

		return array(
			'state'   => 'active',
			'message' => '',
		);
	}

	/**
	 * Whether Telegram summaries are turned on in a settings array.
	 *
	 * @param array $settings Telegram settings.
	 * @return bool
	 */
	private static function telegram_on( array $settings ) {
		return $settings['enabled'] && $settings['providers']['telegram']['enabled'];
	}

	/**
	 * Telegram configuration payload.
	 *
	 * @param string $id Configuration ID.
	 * @return array
	 */
	private function telegram_channel( $id ) {
		$settings = TelegramSettings::get( $id );
		$state    = $this->type_state( Configurations::TELEGRAM );
		$owned    = 'active' === $state['state'];
		$token    = TelegramConnector::status();
		$check    = '' !== $settings['source_slug'] || $settings['page_id']
			? ( new SummaryBuilder() )->check( $settings['source_slug'], $settings['page_id'] )
			: true;
		$next     = $owned ? TelegramDispatcher::next_run( $id ) : null;

		return array(
			'state'               => $state['state'],
			'state_message'       => $state['message'],
			'enabled'             => self::telegram_on( $settings ),
			'source_slug'         => $settings['source_slug'],
			'page_id'             => $settings['page_id'],
			'day_of_week'         => $settings['day_of_week'],
			'time_of_day'         => $settings['time_of_day'],
			'week_scope'          => $settings['week_scope'],
			'chat_ids'            => $settings['providers']['telegram']['chat_ids'],
			'token_configured'    => $token['configured'],
			'token_valid'         => $token['valid'],
			'token_source'        => $token['source'],
			'token_override_name' => TelegramConnector::CREDENTIAL_NAME,
			'connectors_url'      => TelegramConnector::admin_url(),
			'configuration_error' => is_wp_error( $check ) ? $check->get_error_message() : null,
			'next_run'            => $next ? $this->telegram_next_run( $next ) : null,
			'runs'                => array_map( array( $this, 'with_local_time' ), TelegramDispatcher::runs( $id ) ),
			'deliveries'          => $owned ? ( new DeliveryLog() )->recent( $id, TelegramProvider::ID ) : array(),
		);
	}

	/**
	 * Bulk email configuration payload.
	 *
	 * @param string $id Configuration ID.
	 * @return array
	 */
	private function bulk_email_channel( $id ) {
		$state = $this->type_state( Configurations::BULK_EMAIL );
		$next  = BulkEmailAdapter::ACTIVE === $state['state'] ? BulkEmailDispatcher::next_run( $id ) : null;

		return array_merge(
			BulkEmailSettings::get( $id ),
			array(
				'state'          => $state['state'],
				'state_message'  => $state['message'],
				'test_recipient' => wp_get_current_user()->user_email,
				'last_sent_week' => BulkEmailDispatcher::last_sent_week( $id ),
				'next_run'       => $next
					? array(
						'timestamp'  => $next['timestamp'],
						'time_local' => $this->local_time( $next['timestamp'] ),
						'send_week'  => $next['send_week'],
					)
					: null,
				'runs'           => array_map( array( $this, 'with_local_time' ), BulkEmailDispatcher::runs( $id ) ),
			)
		);
	}

	/**
	 * Individual email configuration payload.
	 *
	 * @param string $id Configuration ID.
	 * @return array
	 */
	private function individual_email_channel( $id ) {
		$settings = IndividualEmailSettings::get( $id );
		$check    = ( new IndividualEmailEvents() )->check( $settings['event_selection'] );
		$next     = IndividualEmailDispatcher::next_run( $id );

		return array_merge(
			$settings,
			array(
				'state'               => 'active',
				'state_message'       => '',
				'configuration_error' => is_wp_error( $check ) ? $check->get_error_message() : null,
				'last_sent_week'      => BulkEmailDispatcher::last_sent_week( $id ),
				'next_run'            => $next
					? array(
						'timestamp'  => $next['timestamp'],
						'time_local' => $this->local_time( $next['timestamp'] ),
						'send_week'  => $next['send_week'],
					)
					: null,
				'runs'                => array_map( array( $this, 'with_local_time' ), IndividualEmailDispatcher::runs( $id ) ),
			)
		);
	}

	/**
	 * Why a type's configurations cannot be added, changed or tested on this request, if they cannot.
	 *
	 * @param string $type Notification type.
	 * @return WP_Error|null
	 */
	private function type_unavailable( $type ) {
		if ( Configurations::TELEGRAM === $type ) {
			return Ownership::owns( Ownership::TELEGRAM )
				? null
				: new WP_Error(
					'channel_update_required',
					__( 'Update Fair Events Experimental to manage Telegram summaries here. Nothing was changed.', 'fair-events' ),
					array( 'status' => 409 )
				);
		}

		if ( Configurations::BULK_EMAIL === $type ) {
			$availability = ( new BulkEmailAdapter() )->availability();
			if ( BulkEmailAdapter::INACTIVE === $availability ) {
				return new WP_Error(
					'fair_audience_inactive',
					__( 'Activate Fair Audience to manage and send the weekly email. Your saved settings were not changed.', 'fair-events' ),
					array( 'status' => 409 )
				);
			}
			if ( BulkEmailAdapter::ACTIVE !== $availability || ! Ownership::owns( Ownership::BULK_EMAIL ) ) {
				return new WP_Error(
					'channel_update_required',
					__( 'Update Fair Audience to manage the weekly email here. Nothing was changed.', 'fair-events' ),
					array( 'status' => 409 )
				);
			}
		}

		return null;
	}

	/**
	 * A Telegram configuration's preview/test summary for the selected week relative to today.
	 *
	 * @param string $id Configuration ID.
	 * @return array|WP_Error Summary with its `week`, or a 400 error.
	 */
	private function compose_test_summary( $id ) {
		$settings = TelegramSettings::get( $id );
		$week     = WeekSchedule::target_week( TelegramDispatcher::now(), $settings['week_scope'], TelegramDispatcher::start_of_week() );
		$summary  = ( new SummaryBuilder() )->build( $settings, $week );

		if ( is_wp_error( $summary ) ) {
			return new WP_Error( $summary->get_error_code(), $summary->get_error_message(), array( 'status' => 400 ) );
		}

		$summary['week'] = $week;
		return $summary;
	}

	/**
	 * A bulk email configuration's preview/test email for the selected week relative to today.
	 *
	 * @param string $id Configuration ID.
	 * @return array|WP_Error Subject, body and week, or an error.
	 */
	private function compose_test_email( $id ) {
		$unavailable = $this->type_unavailable( Configurations::BULK_EMAIL );
		if ( $unavailable ) {
			return $unavailable;
		}

		$settings = BulkEmailSettings::get( $id );
		if ( '' === $settings['source_slug'] ) {
			return new WP_Error( 'missing_source', __( 'Choose an event feed and save before previewing the weekly email.', 'fair-events' ), array( 'status' => 400 ) );
		}

		$week = ( new WeeklyEventsProvider() )->for_notification( BulkEmailDispatcher::event_boundaries( $settings['week_scope'], BulkEmailDispatcher::now() ), $settings['source_slug'] );
		if ( is_wp_error( $week ) ) {
			return new WP_Error( $week->get_error_code(), $week->get_error_message(), array( 'status' => 400 ) );
		}

		$email = ( new BulkEmailAdapter() )->compose( $week, $settings );

		return array(
			'subject'    => (string) $email['subject'],
			'html'       => (string) $email['html'],
			'empty'      => ! empty( $email['empty'] ),
			'week_start' => $week['week']['start'],
			'week_end'   => $week['week']['end'],
			'week_title' => EventsWeekSummary::range_title( $week['week']['start'], $week['week']['end'] ),
		);
	}

	/**
	 * An individual email configuration's preview/test email for the selected
	 * week relative to today.
	 *
	 * Built from the saved settings, also while the schedule is off.
	 *
	 * @param string $id Configuration ID.
	 * @return array|WP_Error Recipient, subject, body and week, or an error.
	 */
	private function compose_test_individual_email( $id ) {
		$settings = IndividualEmailSettings::get( $id );
		$week     = IndividualEmailDispatcher::event_week( $settings['week_scope'], BulkEmailDispatcher::now() );

		$occurrences = ( new IndividualEmailEvents() )->for_week( $settings['event_selection'], $week );
		if ( is_wp_error( $occurrences ) ) {
			return new WP_Error( $occurrences->get_error_code(), $occurrences->get_error_message(), array( 'status' => 400 ) );
		}

		$email = IndividualEmailRenderer::compose( $settings, $week, $occurrences );

		return array(
			'recipient'  => $settings['recipient'],
			'subject'    => $email['subject'],
			'html'       => wp_kses_post( $email['html'] ),
			'empty'      => $email['empty'],
			'skip_empty' => $settings['skip_empty'],
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'week_title' => EventsWeekSummary::range_title( $week['start'], $week['end'] ),
		);
	}

	/**
	 * Enabled event sources.
	 *
	 * @return array[]
	 */
	private function sources() {
		return array_map(
			static function ( $source ) {
				return array(
					'slug' => $source['slug'],
					'name' => $source['name'],
				);
			},
			( new EventSourceRepository() )->get_all( true )
		);
	}

	/**
	 * Published, publicly visible pages.
	 *
	 * @param int[] $selected_ids Saved pages, listed even if they no longer qualify.
	 * @return array[]
	 */
	private function pages( array $selected_ids ) {
		$ids = get_posts(
			array(
				'post_type'      => 'page',
				'post_status'    => 'publish',
				'has_password'   => false,
				'posts_per_page' => -1,
				'orderby'        => 'title',
				'order'          => 'ASC',
				'fields'         => 'ids',
				// Every language: the chosen page sets the message language.
				'lang'           => '',
			)
		);

		$ids = array_map( 'intval', $ids );
		foreach ( $selected_ids as $selected_id ) {
			if ( $selected_id && ! in_array( (int) $selected_id, $ids, true ) && get_post( $selected_id ) ) {
				$ids[] = (int) $selected_id;
			}
		}

		return array_map(
			static function ( $id ) {
				return array(
					'id'    => $id,
					'title' => '' !== get_the_title( $id ) ? html_entity_decode( get_the_title( $id ), ENT_QUOTES ) : __( '(no title)', 'fair-events' ),
				);
			},
			$ids
		);
	}

	/**
	 * The next scheduled Telegram send, formatted for display.
	 *
	 * @param array $next Scheduled send.
	 * @return array
	 */
	private function telegram_next_run( array $next ) {
		$week = WeekSchedule::week_from_start( $next['week_start'] );

		return array(
			'timestamp'  => $next['timestamp'],
			'time_local' => $this->local_time( $next['timestamp'] ),
			'week_start' => $week['start'],
			'week_end'   => $week['end'],
			'week_title' => EventsWeekSummary::range_title( $week['start'], $week['end'] ),
		);
	}

	/**
	 * Add a site-local display time and the covered week's title to a run record.
	 *
	 * @param array $run Run record with a UTC `time`.
	 * @return array
	 */
	private function with_local_time( $run ) {
		$run['time_local'] = $this->local_time( strtotime( $run['time'] . ' UTC' ) );
		$run['week_title'] = ! empty( $run['week_start'] ) && ! empty( $run['week_end'] )
			? EventsWeekSummary::range_title( $run['week_start'], $run['week_end'] )
			: '';
		return $run;
	}

	/**
	 * A moment in the site's date and time format and timezone.
	 *
	 * @param int $timestamp Unix timestamp.
	 * @return string
	 */
	private function local_time( $timestamp ) {
		return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), $timestamp );
	}
}
