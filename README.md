This project is a Matrix Application Service (AS) that creates a bidirectional bridge between the Google Play Store and a Matrix homeserver. It is designed to streamline the customer support workflow for Android developers and support teams who use Matrix as their primary communication platform.  

The bridge periodically polls the Google Play Developer API for new app reviews. When a new review is found, it is formatted and posted as a message into a designated Matrix room by a dedicated bot user. Support team members can then discuss the review and, when ready, reply directly to the message in their Matrix client. The bridge intercepts this reply, authenticates with the Google API, and posts the response publicly on the Google Play Store, creating a seamless feedback loop.  

By centralizing this critical customer feedback channel, the bridge eliminates the need to constantly monitor the Play Console, improves response times, and makes all user feedback visible and actionable within your team's existing chat environment.

Key Features:

    Automated Review Ingestion: Fetches new Google Play Store reviews and posts them into a Matrix room in near real-time.

    Reply from Matrix: Allows authorized users to reply to reviews directly from their chat client, with replies appearing on the Play Store.

    Application Service Architecture: Runs as a reliable, server-side integration with a Synapse homeserver, with exclusive control over its own bot user.   

Stateful and Resilient: Built to be a persistent service that tracks processed reviews to prevent duplicates and manage API rate limits gracefully.  

Easy Configuration: Managed via simple YAML configuration files for both the bridge and the homeserver registration.
