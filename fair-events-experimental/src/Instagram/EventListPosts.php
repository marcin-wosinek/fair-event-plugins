<?php
/**
 * Scheduled Instagram event-list posts for Fair Events notifications
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Instagram;

use FairEventsExperimental\Core\Features;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * What Fair Events' Instagram notifications use from this plugin: the
 * connected account, the post's image and caption, the publicly reachable
 * copy of the image Instagram downloads, and the publishing calls.
 *
 * Fair Events keeps the settings, schedule, duplicate prevention and
 * history; it checks for this class and VERSION before using it. Never
 * change these methods' signatures; add new methods and raise VERSION
 * instead.
 *
 * Available only while the `instagram` feature is on and this plugin owns
 * the connection ({@see Ownership}), the same condition as the Instagram
 * page. Previews never store anything; a scheduled post's image is stored
 * under a random name in the uploads folder only while Instagram processes
 * it, and removed afterwards.
 */
class EventListPosts {

	const VERSION = 1;

	/**
	 * Folder in uploads holding images while Instagram downloads them.
	 */
	const UPLOAD_FOLDER = 'fair-events-instagram';

	/**
	 * Image renderer.
	 *
	 * @var EventListImage
	 */
	private $image;

	/**
	 * Graph API client, created on first use.
	 *
	 * @var GraphClient|null
	 */
	private $client;

	/**
	 * Constructor.
	 *
	 * @param EventListImage|null $image  Image renderer.
	 * @param GraphClient|null    $client Graph API client.
	 */
	public function __construct( $image = null, $client = null ) {
		$this->image  = $image ? $image : new EventListImage();
		$this->client = $client;
	}

	/**
	 * Whether scheduled Instagram posts can be used on this request.
	 *
	 * @return bool
	 */
	public static function available() {
		return Features::is_enabled( 'instagram' ) && Ownership::owns();
	}

	/**
	 * Administrator-facing reason why they cannot, or '' when they can.
	 *
	 * @return string
	 */
	public static function unavailable_message() {
		if ( ! Features::is_enabled( 'instagram' ) ) {
			return __( 'Instagram posts are paused because the Instagram feature is off. Turn on Instagram in Fair Events → Settings → Experimental. The notification’s settings are kept, and posting resumes with the next scheduled week.', 'fair-events-experimental' );
		}
		if ( ! Ownership::owns() ) {
			return __( 'Instagram posts are paused because Fair Events Experimental does not manage the Instagram connection on this site yet. Open Fair Events → Instagram for what to do. The notification’s settings are kept, and posting resumes with the next scheduled week.', 'fair-events-experimental' );
		}
		return '';
	}

	/**
	 * The connected account, without any credential.
	 *
	 * @return array{usable: bool, user_id: string, username: string, message: string, settings_url: string}
	 */
	public function account() {
		$reason = Connection::unavailable_reason();

		return array(
			'usable'       => null === $reason,
			'user_id'      => Connection::user_id(),
			'username'     => (string) get_option( Connection::USERNAME_OPTION, '' ),
			'message'      => $reason ? $reason->get_error_message() : '',
			'settings_url' => admin_url( 'admin.php?page=fair-events-instagram' ),
		);
	}

	/**
	 * The post for a summary: one JPEG and its caption.
	 *
	 * @param array $summary Summary from Fair Events' SummaryBuilder.
	 * @return array{caption: string, jpeg: string, width: int, height: int}|WP_Error
	 */
	public function compose( array $summary ) {
		$caption = EventListCaption::format( $summary );
		if ( is_wp_error( $caption ) ) {
			return $caption;
		}
		$image = $this->image->render( $summary );
		if ( is_wp_error( $image ) ) {
			return $image;
		}

		return array(
			'caption' => $caption,
			'jpeg'    => $image['jpeg'],
			'width'   => $image['width'],
			'height'  => $image['height'],
		);
	}

	/**
	 * Store an image where Instagram can download it.
	 *
	 * @param string $jpeg JPEG bytes.
	 * @return array{path: string, url: string}|WP_Error
	 */
	public function store_image( $jpeg ) {
		$uploads = wp_upload_dir( null, false );
		if ( ! empty( $uploads['error'] ) || empty( $uploads['basedir'] ) ) {
			return new WP_Error( 'instagram_asset_failed', __( 'The image for Instagram could not be stored: the uploads folder is not writable. Nothing was published.', 'fair-events-experimental' ) );
		}

		$dir = trailingslashit( $uploads['basedir'] ) . self::UPLOAD_FOLDER;
		if ( ! wp_mkdir_p( $dir ) ) {
			return new WP_Error( 'instagram_asset_failed', __( 'The image for Instagram could not be stored: the uploads folder is not writable. Nothing was published.', 'fair-events-experimental' ) );
		}
		// No directory listing: the random names are what keeps images private.
		if ( ! file_exists( $dir . '/index.php' ) ) {
			file_put_contents( $dir . '/index.php', "<?php\n// Silence is golden.\n" ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents
		}

		$name = strtolower( wp_generate_password( 32, false, false ) ) . '.jpg';
		$path = $dir . '/' . $name;
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_file_put_contents -- a fresh file in uploads.
		if ( strlen( $jpeg ) !== file_put_contents( $path, $jpeg ) ) {
			wp_delete_file( $path );
			return new WP_Error( 'instagram_asset_failed', __( 'The image for Instagram could not be stored: the uploads folder is not writable. Nothing was published.', 'fair-events-experimental' ) );
		}

		$url = trailingslashit( $uploads['baseurl'] ) . self::UPLOAD_FOLDER . '/' . $name;
		if ( 'https' !== strtolower( (string) wp_parse_url( $url, PHP_URL_SCHEME ) ) ) {
			wp_delete_file( $path );
			return new WP_Error( 'instagram_asset_not_public', __( 'Instagram downloads the image from this site, which needs an HTTPS address. Serve the site over HTTPS. Nothing was published.', 'fair-events-experimental' ) );
		}

		return array(
			'path' => $path,
			'url'  => $url,
		);
	}

	/**
	 * Remove a stored image. Only files in the upload folder are removed.
	 *
	 * @param string $path Path from store_image().
	 * @return void
	 */
	public function delete_image( $path ) {
		$path = (string) $path;
		if ( preg_match( '#/' . self::UPLOAD_FOLDER . '/[a-z0-9]{32}\.jpg$#', $path ) && file_exists( $path ) ) {
			wp_delete_file( $path );
		}
	}

	/**
	 * Create an image container. See {@see GraphClient::create_container()}.
	 *
	 * @param string $image_url Public image URL.
	 * @param string $caption   Caption.
	 * @return array
	 */
	public function create_container( $image_url, $caption ) {
		return $this->client()->create_container( $image_url, $caption );
	}

	/**
	 * A container's status. See {@see GraphClient::container_status()}.
	 *
	 * @param string $container_id Container ID.
	 * @return array
	 */
	public function container_status( $container_id ) {
		return $this->client()->container_status( $container_id );
	}

	/**
	 * Publish a container. See {@see GraphClient::publish()}.
	 *
	 * @param string $container_id Container ID.
	 * @return array
	 */
	public function publish( $container_id ) {
		return $this->client()->publish( $container_id );
	}

	/**
	 * A post's link. See {@see GraphClient::permalink()}.
	 *
	 * @param string $media_id Media ID.
	 * @return string
	 */
	public function permalink( $media_id ) {
		return $this->client()->permalink( $media_id );
	}

	/**
	 * The client for the stored connection.
	 *
	 * @return GraphClient
	 */
	private function client() {
		if ( ! $this->client ) {
			$this->client = GraphClient::from_connection();
		}
		return $this->client;
	}
}
