# Filters

To help users easily find their content you can suggest context aware filters like we have in Raindrop.io app

![Filters right above search field](https://3611960587-files.gitbook.io/~/files/v0/b/gitbook-legacy-files/o/assets%2F-M-GPP1TyNN8gNuijaj7%2F-M-oej2Q4_QeQb3lfFaV%2F-M-of2jvit9BqVisVU9y%2Ffilters.png?alt=media&token=d1992f10-6dc3-401c-9332-81e69fc876ac)

## Fields

| Field            | Type            | Description                                              |
| ---------------- | --------------- | -------------------------------------------------------- |
| broken           | `Object`        |                                                          |
| broken.count     | `Integer`       | Broken links count                                       |
| duplicates       | `Object`        |                                                          |
| duplicates.count | `Integer`       | Duplicate links count                                    |
| important        | `Object`        |                                                          |
| important.count  | `Integer`       | Count of raindrops that marked as "favorite"             |
| notag            | `Object`        |                                                          |
| notag.count      | `Integer`       | Count of raindrops without any tag                       |
| tags             | `Array<Object>` | List of tags in format `{"_id": "tag name", "count": 1}` |
| types            | `Array<Object>` | List of types in format `{"_id": "type", "count": 1}`    |

## Get filters

<mark style="color:blue;">`GET`</mark> `https://api.raindrop.io/rest/v1/filters/{collectionId}`

#### Path Parameters

| Name         | Type   | Description                |
| ------------ | ------ | -------------------------- |
| collectionId | string | Collection ID. `0` for all |

#### Query Parameters

| Name     | Type   | Description                                                                                                                  |
| -------- | ------ | ---------------------------------------------------------------------------------------------------------------------------- |
| tagsSort | string | <p>Sort tags by:<br><strong><code>-count</code></strong> by count, default<br><strong><code>\_id</code></strong> by name</p> |
| search   | string | Check "raindrops" documentation for more details                                                                             |

{% tabs %}
{% tab title="200 " %}

```javascript
{
  "result": true,
  "broken": {
    "count": 31
  },
  "duplicates": {
    "count": 7
  },
  "important": {
    "count": 59
  },
  "notag": {
    "count": 1366
  },
  "tags": [
    {
      "_id": "performanc",
      "count": 19
    },
    {
      "_id": "guides",
      "count": 9
    }
  ],
  "types": [
    {
      "_id": "article",
      "count": 313
    },
    {
      "_id": "image",
      "count": 143
    },
    {
      "_id": "video",
      "count": 26
    },
    {
      "_id": "document",
      "count": 7
    }
  ]
}
```

{% endtab %}
{% endtabs %}
