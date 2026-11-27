<?php
/**
 * WhatsApp sharing reminders administrator REST API.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\API;

use FairEventsExperimental\Core\Plugin;
use FairEventsExperimental\Frontend\WeeklySummaryPage;
use FairEventsExperimental\Models\TeamMemberRepository;
use FairEventsExperimental\WhatsApp\Client;
use FairEventsExperimental\WhatsApp\Configuration;
use FairEventsExperimental\WhatsApp\Connector;
use FairEventsExperimental\WhatsApp\ReminderDispatcher;
use FairEventsExperimental\WhatsApp\ReminderRuns;
use FairEventsExperimental\WhatsApp\ReminderSchedule;
use FairEventsExperimental\WhatsApp\SharingReminders;
use WP_Error;
use WP_REST_Controller;
use WP_REST_Server;

defined( 'WPINC' ) || die;

// phpcs:disable Generic.Commenting.DocComment.MissingShort,Squiz.Commenting.FunctionComment.ParamCommentFullStop,Squiz.Commenting.VariableComment.Missing

/**
 * Per-feed sharing reminders: each feed's collaborator, consent, template
 * and schedule, and the history of scheduled runs.
 *
 * Administrator only. Collaborator numbers are returned only here, to the
 * editor; the history shows them masked.
 */
class WhatsAppRemindersController extends WP_REST_Controller {
	protected $namespace = 'fair-events-experimental/v1';
	protected $rest_base = 'whatsapp/reminders';

	/** Runs listed in the history. */
	private const HISTORY_SIZE = 30;

	/** Register routes. */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base,
			array(
				'methods'             => WP_REST_Server::READABLE,
				'callback'            => array( $this, 'get_items' ),
				'permission_callback' => array( $this, 'permissions_check' ),
			)
		);
		register_rest_route(
			$this->namespace,
			'/' . $this->rest_base . '/(?P<source_id>\d+)',
			array(
				'args' => array(
					'source_id' => array(
						'type'              => 'integer',
						'minimum'           => 1,
						'sanitize_callback' => 'absint',
					),
				),
				array(
					'methods'             => WP_REST_Server::EDITABLE,
					'callback'            => array( $this, 'update_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'enabled'     => array(
							'type'              => 'boolean',
							'required'          => true,
							'validate_callback' => 'rest_validate_request_arg',
						),
						'day_of_week' => array(
							'type'              => 'integer',
							'required'          => true,
							'minimum'           => 1,
							'maximum'           => 7,
							'validate_callback' => static function ( $value ) {
								return is_numeric( $value ) && (int) $value >= 1 && (int) $value <= 7;
							},
						),
						'time_of_day' => array(
							'type'              => 'string',
							'required'          => true,
							'validate_callback' => array( SharingReminders::class, 'valid_time' ),
						),
						'recipient'   => array(
							'type'    => array( 'object', 'null' ),
							'default' => null,
						),
						'consent'     => array(
							'type'    => 'boolean',
							'default' => false,
						),
						'template'    => array(
							'type'    => array( 'object', 'null' ),
							'default' => null,
						),
					),
				),
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
			)
		);
	}

	/** @return bool */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Every feed with its reminder, the collaborators to choose from, the
	 * WhatsApp connection state and recent runs. Never contacts Meta.
	 *
	 * @param \WP_REST_Request|null $request Request, unused.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function get_items( $request = null ) {
		unset( $request );
		if ( ! class_exists( '\FairEvents\Database\EventSourceRepository' ) ) {
			return new WP_Error(
				'fair_events_outdated',
				__( 'Sharing reminders need an up-to-date Fair Events plugin.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		$feeds = array();
		foreach ( ( new \FairEvents\Database\EventSourceRepository() )->get_all() as $source ) {
			$feeds[] = $this->present_feed( $source );
		}

		return rest_ensure_response(
			array(
				'feeds'                  => $feeds,
				'connection'             => self::connection(),
				'team_members_available' => Plugin::team_members_available(),
				'team_members'           => self::team_members(),
				'history'                => array_map( array( $this, 'present_run' ), ( new ReminderRuns() )->recent( self::HISTORY_SIZE ) ),
				'retention_days'         => ReminderRuns::RETENTION_DAYS,
			)
		);
	}

	/**
	 * Save a feed's reminder. A collaborator needs confirmed consent for
	 * the number in effect; a newly chosen template, or one checked against
	 * another link, is checked with Meta.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function update_item( $request ) {
		$source_id = (int) $request->get_param( 'source_id' );
		$source    = $this->find_source( $source_id );
		if ( is_wp_error( $source ) ) {
			return $source;
		}

		$saved     = SharingReminders::get( $source_id );
		$recipient = $this->parse_recipient( $request->get_param( 'recipient' ) );
		if ( is_wp_error( $recipient ) ) {
			return $recipient;
		}

		$consent = null;
		if ( $recipient ) {
			$digits = self::recipient_digits( $recipient );
			if ( true !== $request->get_param( 'consent' ) ) {
				return new WP_Error(
					'consent_required',
					__( 'Confirm that the collaborator agreed to receive WhatsApp reminders at this number. Nothing was saved.', 'fair-events-experimental' ),
					array( 'status' => 400 )
				);
			}
			$keep    = $saved && $saved['consent'] && '' !== $digits && SharingReminders::consented( $saved, $digits );
			$consent = $keep ? $saved['consent'] : SharingReminders::consent_for( $digits );
		}

		$expected_url = WeeklySummaryPage::url( (string) $source['slug'] );
		$template     = $this->parse_template( $request->get_param( 'template' ), $saved, $expected_url );
		if ( is_wp_error( $template ) ) {
			return $template;
		}

		$reminder = SharingReminders::save(
			$source_id,
			array(
				'enabled'     => (bool) $request->get_param( 'enabled' ),
				'day_of_week' => (int) $request->get_param( 'day_of_week' ),
				'time_of_day' => (string) $request->get_param( 'time_of_day' ),
				'recipient'   => $recipient,
				'consent'     => $consent,
				'template'    => $template,
			)
		);
		if ( ! $reminder ) {
			return new WP_Error(
				'reminder_not_saved',
				__( 'The reminder could not be saved. Try again; if it keeps failing, check the site\'s database.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}
		ReminderSchedule::reschedule( $source_id, $reminder );

		return rest_ensure_response( $this->present_feed( $source ) );
	}

	/**
	 * Remove a feed's reminder: its collaborator, template and schedule.
	 * Its run history stays.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$source_id = (int) $request->get_param( 'source_id' );
		ReminderSchedule::unschedule( $source_id );
		if ( ! SharingReminders::delete( $source_id ) ) {
			return new WP_Error(
				'reminder_not_found',
				__( 'This event feed has no sharing reminder.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}
		$source = ReminderDispatcher::source( $source_id );
		return rest_ensure_response(
			$source ? $this->present_feed( $source ) : array(
				'source_id' => $source_id,
				'reminder'  => null,
			)
		);
	}

	/**
	 * The feed to save a reminder for.
	 *
	 * @param int $source_id Event feed ID.
	 * @return array|WP_Error
	 */
	private function find_source( $source_id ) {
		$source = ReminderDispatcher::source( $source_id );
		if ( false === $source ) {
			return new WP_Error(
				'fair_events_outdated',
				__( 'Sharing reminders need an up-to-date Fair Events plugin.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}
		if ( ! $source ) {
			return new WP_Error(
				'feed_not_found',
				__( 'This event feed no longer exists. Reload the page.', 'fair-events-experimental' ),
				array( 'status' => 404 )
			);
		}
		return $source;
	}

	/**
	 * The submitted collaborator, checked.
	 *
	 * @param mixed $raw Submitted recipient, or null to remove it.
	 * @return array|null|WP_Error
	 */
	private function parse_recipient( $raw ) {
		if ( null === $raw ) {
			return null;
		}
		$kind = is_array( $raw ) ? (string) ( $raw['kind'] ?? '' ) : '';

		if ( SharingReminders::KIND_MEMBER === $kind ) {
			if ( ! Plugin::team_members_available() ) {
				return new WP_Error(
					'team_members_unavailable',
					__( 'The team member directory is turned off. Enter the collaborator\'s name and number instead.', 'fair-events-experimental' ),
					array( 'status' => 400 )
				);
			}
			$member = ( new TeamMemberRepository() )->find( absint( $raw['member_id'] ?? 0 ) );
			if ( ! $member ) {
				return new WP_Error(
					'member_not_found',
					__( 'This team member no longer exists. Choose another collaborator.', 'fair-events-experimental' ),
					array( 'status' => 400 )
				);
			}
			if ( '' === Client::normalize_recipient( (string) $member['phone'] ) ) {
				return new WP_Error(
					'member_without_number',
					__( 'This team member has no phone number in international format, such as +34 600 123 456. Add it in Team members, or enter a name and number instead.', 'fair-events-experimental' ),
					array( 'status' => 400 )
				);
			}
			return array(
				'kind'      => SharingReminders::KIND_MEMBER,
				'member_id' => (int) $member['id'],
				'name'      => SharingReminders::member_name( $member ),
			);
		}

		if ( SharingReminders::KIND_STANDALONE === $kind ) {
			$name   = trim( sanitize_text_field( (string) ( $raw['name'] ?? '' ) ) );
			$number = Client::normalize_recipient( (string) ( $raw['number'] ?? '' ) );
			if ( '' === $name ) {
				return new WP_Error(
					'name_required',
					__( 'Enter the collaborator\'s name.', 'fair-events-experimental' ),
					array( 'status' => 400 )
				);
			}
			if ( '' === $number ) {
				return new WP_Error(
					'invalid_recipient',
					__( 'Enter the collaborator\'s WhatsApp number in international format, with the country code, such as +34 600 123 456.', 'fair-events-experimental' ),
					array( 'status' => 400 )
				);
			}
			return array(
				'kind'   => SharingReminders::KIND_STANDALONE,
				'name'   => mb_substr( $name, 0, SharingReminders::MAX_NAME_LENGTH ),
				'number' => $number,
			);
		}

		return new WP_Error(
			'invalid_recipient_kind',
			__( 'Choose a team member or enter a name and number.', 'fair-events-experimental' ),
			array( 'status' => 400 )
		);
	}

	/**
	 * The submitted template. A template already checked against the
	 * feed's current link is kept as it is; any other one is checked with
	 * Meta first.
	 *
	 * @param mixed      $raw          Submitted template, or null to remove it.
	 * @param array|null $saved        Saved reminder.
	 * @param string     $expected_url The feed's weekly-summary link.
	 * @return array|null|WP_Error
	 */
	private function parse_template( $raw, $saved, $expected_url ) {
		if ( null === $raw ) {
			return null;
		}
		$name     = is_array( $raw ) ? ( $raw['name'] ?? null ) : null;
		$language = is_array( $raw ) ? ( $raw['language'] ?? null ) : null;
		if ( ! Client::valid_template_name( $name ) || ! Client::valid_language( $language ) ) {
			return new WP_Error(
				'invalid_template',
				__( 'Choose one of the approved templates.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}
		$current = $saved ? $saved['template'] : null;
		if ( $current && $current['name'] === $name && $current['language'] === $language && SharingReminders::same_url( $current['url'], $expected_url ) ) {
			return $current;
		}

		if ( ! Connector::status()['configured'] || ! Configuration::validation() ) {
			return new WP_Error(
				'whatsapp_not_ready',
				__( 'Validate the WhatsApp connection in Fair Events → WhatsApp before choosing a template. Nothing was saved.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}
		$templates = ( new Client( Connector::token() ) )->templates( Configuration::ids()['waba_id'] );
		if ( ! $templates['ok'] ) {
			return new WP_Error(
				'templates_unavailable',
				__( 'The templates could not be checked with WhatsApp. Try again later. Nothing was saved.', 'fair-events-experimental' ),
				array(
					'status' => $templates['temporary'] ? 503 : 400,
					'reason' => $templates['code'],
				)
			);
		}
		$choice = array(
			'name'     => $name,
			'language' => $language,
		);
		if ( ! ReminderDispatcher::offered( $templates['templates'], $choice, $expected_url ) ) {
			return new WP_Error(
				'template_url_mismatch',
				sprintf(
					/* translators: %s: link to the event feed's weekly summary */
					__( 'This template is not an approved template without parameters whose button opens %s. Choose another template, or submit one with that button link. Nothing was saved.', 'fair-events-experimental' ),
					$expected_url
				),
				array( 'status' => 400 )
			);
		}
		return array_merge( $choice, array( 'url' => $expected_url ) );
	}

	/**
	 * Digits of a parsed collaborator's number.
	 *
	 * @param array $recipient Parsed recipient.
	 * @return string
	 */
	private static function recipient_digits( array $recipient ) {
		if ( SharingReminders::KIND_STANDALONE === $recipient['kind'] ) {
			return $recipient['number'];
		}
		$member = ( new TeamMemberRepository() )->find( $recipient['member_id'] );
		return $member ? Client::normalize_recipient( (string) $member['phone'] ) : '';
	}

	/**
	 * A feed with its reminder.
	 *
	 * @param array $source Event feed.
	 * @return array
	 */
	private function present_feed( array $source ) {
		$source_id    = (int) $source['id'];
		$reminder     = SharingReminders::get( $source_id );
		$expected_url = WeeklySummaryPage::url( (string) $source['slug'] );
		$next         = $reminder && $reminder['enabled'] ? ReminderSchedule::next_run( $source_id ) : null;

		return array(
			'source_id'    => $source_id,
			'name'         => (string) $source['name'],
			'slug'         => (string) $source['slug'],
			'feed_enabled' => ! empty( $source['enabled'] ),
			'has_page'     => ! empty( $source['page_id'] ),
			'summary_url'  => $expected_url,
			'reminder'     => $reminder ? $this->present_reminder( $reminder, $expected_url ) : null,
			'next_run'     => $next ? self::local_time( gmdate( 'Y-m-d H:i:s', $next['timestamp'] ) ) : null,
		);
	}

	/**
	 * A reminder for the editor, with the collaborator's number and what
	 * keeps it from sending.
	 *
	 * @param array  $reminder     Normalized reminder.
	 * @param string $expected_url The feed's weekly-summary link.
	 * @return array
	 */
	private function present_reminder( array $reminder, $expected_url ) {
		$destination = SharingReminders::destination( $reminder );
		$recipient   = null;
		if ( $reminder['recipient'] ) {
			$recipient = array(
				'kind'      => $reminder['recipient']['kind'],
				'member_id' => $reminder['recipient']['member_id'] ? $reminder['recipient']['member_id'] : null,
				'name'      => '' !== $destination['name'] ? $destination['name'] : $reminder['recipient']['name'],
				'number'    => '' === $destination['digits'] ? '' : '+' . $destination['digits'],
			);
		}
		$template = null;
		if ( $reminder['template'] ) {
			$template = array(
				'name'         => $reminder['template']['name'],
				'language'     => $reminder['template']['language'],
				'url'          => $reminder['template']['url'],
				'matches_feed' => SharingReminders::same_url( $reminder['template']['url'], $expected_url ),
			);
		}

		return array(
			'enabled'            => $reminder['enabled'],
			'day_of_week'        => $reminder['day_of_week'],
			'time_of_day'        => $reminder['time_of_day'],
			'recipient'          => $recipient,
			'destination_status' => $destination['status'],
			'consent_confirmed'  => 'ok' === $destination['status'],
			'template'           => $template,
		);
	}

	/**
	 * A run for the history, with the delivery it started.
	 *
	 * @param array $row Run row with `delivery`.
	 * @return array
	 */
	public function present_run( array $row ) {
		$source = ReminderDispatcher::source( (int) $row['source_id'] );
		return array(
			'id'               => (int) $row['id'],
			'source_id'        => (int) $row['source_id'],
			'feed_name'        => is_array( $source ) ? (string) $source['name'] : '',
			'send_week'        => (string) $row['send_week'],
			'state'            => (string) $row['state'],
			'reason'           => (string) $row['reason'],
			'message'          => self::run_message( (string) $row['state'], (string) $row['reason'] ),
			'recipient'        => (string) $row['recipient'],
			'template'         => '' === (string) $row['template_name'] ? null : array(
				'name'     => (string) $row['template_name'],
				'language' => (string) $row['template_language'],
			),
			'created_at_local' => self::local_time( $row['created_at'] ),
			'delivery'         => $row['delivery'] ? ( new WhatsAppController() )->present_delivery( $row['delivery'] ) : null,
		);
	}

	/**
	 * What a run did, for administrators.
	 *
	 * @param string $state  Run state.
	 * @param string $reason Reason code.
	 * @return string
	 */
	private static function run_message( $state, $reason ) {
		switch ( $reason ) {
			case 'feed_unavailable':
				return __( 'Not sent: the event feed is disabled or was deleted.', 'fair-events-experimental' );
			case 'no_recipient':
				return __( 'Not sent: no collaborator is designated.', 'fair-events-experimental' );
			case 'recipient_unavailable':
				return __( 'Not sent: the collaborator\'s team member profile, its number or the team member directory is no longer available.', 'fair-events-experimental' );
			case 'recipient_needs_confirmation':
				return __( 'Not sent: the collaborator\'s number changed, so their agreement must be confirmed again.', 'fair-events-experimental' );
			case 'no_template':
				return __( 'Not sent: no template is chosen.', 'fair-events-experimental' );
			case 'template_url_changed':
				return __( 'Not sent: the feed\'s weekly-summary link changed since the template was chosen. Choose a template whose button opens the new link.', 'fair-events-experimental' );
			case 'summary_unavailable':
				return __( 'Not sent: the feed\'s weekly summary is unavailable. Check that the feed has a published page.', 'fair-events-experimental' );
			case 'empty_week':
				return __( 'Not sent: the feed has no public events this week.', 'fair-events-experimental' );
			case 'whatsapp_not_ready':
				return __( 'Failed: the WhatsApp connection is not set up or not validated.', 'fair-events-experimental' );
			case 'template_invalid':
				return __( 'Failed: WhatsApp no longer offers this template as approved, in this language, with a button opening the feed\'s page.', 'fair-events-experimental' );
			case 'not_recorded':
				return __( 'Failed: the send could not be recorded, so nothing was sent.', 'fair-events-experimental' );
		}
		if ( 0 === strpos( $reason, 'templates_' ) ) {
			return __( 'Failed: the templates could not be checked with WhatsApp, so nothing was sent.', 'fair-events-experimental' );
		}
		switch ( $state ) {
			case ReminderRuns::ACCEPTED:
				return __( 'Sent to WhatsApp.', 'fair-events-experimental' );
			case ReminderRuns::NOT_ACCEPTED:
				return __( 'WhatsApp refused the message.', 'fair-events-experimental' );
			case ReminderRuns::UNCERTAIN:
			case ReminderRuns::SENDING:
				return __( 'WhatsApp did not confirm the send, so it may or may not have gone out. It is not sent again automatically.', 'fair-events-experimental' );
			case ReminderRuns::CLAIMED:
				return __( 'Started; no outcome was recorded. It is not run again automatically.', 'fair-events-experimental' );
			default:
				return '';
		}
	}

	/**
	 * Whether scheduled reminders can be sent: a token and a validation of
	 * the saved account.
	 *
	 * @return array{ready: bool, whatsapp_url: string}
	 */
	private static function connection() {
		return array(
			'ready'        => Connector::status()['configured'] && null !== Configuration::validation(),
			'whatsapp_url' => admin_url( 'admin.php?page=fair-events-whatsapp' ),
		);
	}

	/**
	 * Team members to choose a collaborator from, with their numbers.
	 *
	 * @return array[]
	 */
	private static function team_members() {
		if ( ! Plugin::team_members_available() ) {
			return array();
		}
		$members = array();
		foreach ( ( new TeamMemberRepository() )->all() as $member ) {
			$digits    = Client::normalize_recipient( (string) $member['phone'] );
			$members[] = array(
				'id'     => (int) $member['id'],
				'name'   => SharingReminders::member_name( $member ),
				'number' => '' === $digits ? '' : '+' . $digits,
			);
		}
		return $members;
	}

	/**
	 * A stored UTC time in the site's date and time format.
	 *
	 * @param string|null $utc MySQL datetime in UTC.
	 * @return string|null
	 */
	private static function local_time( $utc ) {
		if ( ! $utc ) {
			return null;
		}
		return wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ), strtotime( $utc . ' UTC' ) );
	}
}
